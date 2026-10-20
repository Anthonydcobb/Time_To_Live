import { describe, expect, it } from "vitest";
import { Network } from "../src/sim/network";
import { Router } from "../src/sim/devices/router";
import { Switch } from "../src/sim/devices/switch";
import { type7Decode, type7Encode, type5Hash, type5Verify } from "../src/sim/ios/passwords";
import { finish, type } from "./helpers";

function router() {
  const net = new Network();
  return net.add(new Router("R1"));
}

describe("modes and prompts", () => {
  it("walks user, enable, config, interface and back", () => {
    const r = router();
    expect(r.console.prompt()).toBe("Router>");
    type(r, "en");
    expect(r.console.prompt()).toBe("Router#");
    expect(type(r, "conf t")).toEqual(["Enter configuration commands, one per line.  End with CNTL/Z."]);
    expect(r.console.prompt()).toBe("Router(config)#");
    type(r, "int g0/0");
    expect(r.console.prompt()).toBe("Router(config-if)#");
    type(r, "exit");
    expect(r.console.prompt()).toBe("Router(config)#");
    type(r, "line con 0");
    expect(r.console.prompt()).toBe("Router(config-line)#");
    type(r, "end");
    expect(r.console.prompt()).toBe("Router#");
    type(r, "disable");
    expect(r.console.prompt()).toBe("Router>");
  });

  it("accepts interface names in every common spelling", () => {
    const r = router();
    type(r, "en", "conf t");
    for (const name of ["g0/1", "gig0/1", "Gig 0/1", "GigabitEthernet0/1", "gigabitethernet 0/1"]) {
      type(r, `interface ${name}`);
      expect(r.console.ifaces).toEqual(["GigabitEthernet0/1"]);
      type(r, "exit");
    }
  });

  it("falls back to global config commands from a sub-mode", () => {
    const r = router();
    type(r, "en", "conf t", "int g0/0", "hostname R1");
    expect(r.console.prompt()).toBe("R1(config)#");
  });

  it("runs privileged commands from config mode with do", () => {
    const r = router();
    const out = type(r, "en", "conf t", "do show ip int brief");
    expect(out.some((l) => l.startsWith("Interface"))).toBe(true);
    expect(r.console.prompt()).toBe("Router(config)#");
  });

  it("leaves config mode on Ctrl+Z", () => {
    const r = router();
    type(r, "en", "conf t", "int g0/0");
    r.console.ctrlZ();
    expect(r.console.prompt()).toBe("Router#");
  });
});

describe("errors", () => {
  it("puts the caret under the first bad character", () => {
    const r = router();
    type(r, "en", "conf t");
    const out = type(r, "hostnme R1");
    // "Router(config)#" is 15 characters, and "hostn" still matches "hostname".
    expect(out[0]).toBe(" ".repeat(20) + "^");
    expect(out[1]).toBe("% Invalid input detected at '^' marker.");
  });

  it("reports ambiguous and incomplete commands", () => {
    const r = router();
    type(r, "en");
    expect(type(r, "c")[0]).toBe('% Ambiguous command:  "c"');
    expect(type(r, "show ip")[0]).toBe("% Incomplete command.");
    type(r, "conf t");
    expect(type(r, "interface gig")[0]).toBe("% Incomplete command.");
  });

  it("treats an unknown word as a hostname, slowly, until domain lookup is off", () => {
    const r = router();
    const slow = r.console.input("shw");
    expect(slow.lines[0]).toBe('Translating "shw"...domain server (255.255.255.255)');
    const start = r.clock.now;
    expect(finish(r, slow.job!)).toEqual(["% Unknown command or computer name, or unable to find computer address"]);
    expect(r.clock.now - start).toBe(5000);
    type(r, "en", "conf t", "no ip domain-lookup", "end");
    const fast = r.console.input("shw");
    expect(fast.lines).toEqual(['Translating "shw"', "% Unknown command or computer name, or unable to find computer address"]);
    expect(fast.job).toBeUndefined();
  });

  it("rejects bad masks, network addresses and overlapping subnets", () => {
    const r = router();
    type(r, "en", "conf t", "int g0/0");
    expect(type(r, "ip address 192.168.1.1 255.0.255.0")[0]).toMatch(/^Bad mask 0xFF00FF00/);
    expect(type(r, "ip address 192.168.1.0 255.255.255.0")[0]).toBe("Bad mask /24 for address 192.168.1.0");
    type(r, "ip address 192.168.1.1 255.255.255.0", "int g0/1");
    expect(type(r, "ip address 192.168.1.2 255.255.255.0")[0]).toBe("% 192.168.1.0 overlaps with GigabitEthernet0/0");
  });

  it("refuses an IP address on a switch access port", () => {
    const net = new Network();
    const s = net.add(new Switch("S1"));
    type(s, "en", "conf t", "int fa0/1");
    expect(type(s, "ip address 10.0.0.2 255.255.255.0")[1]).toBe("% Invalid input detected at '^' marker.");
  });
});

describe("help and completion", () => {
  it("lists commands with ?", () => {
    const r = router();
    const { lines } = r.console.help("");
    expect(lines.some((l) => /^ {2}enable +Turn on privileged commands$/.test(l))).toBe(true);
    expect(lines.some((l) => l.trim().startsWith("configure"))).toBe(false);
  });

  it("completes a partial word with ?", () => {
    const r = router();
    type(r, "en");
    expect(r.console.help("sh").lines).toEqual(["show  ", ""]);
    expect(r.console.help("co").lines).toEqual(["configure  copy  ", ""]);
  });

  it("lists next keywords and <cr>", () => {
    const r = router();
    type(r, "en");
    const lines = r.console.help("show ip ").lines.map((l) => l.trim().split(/\s+/)[0]);
    expect(lines).toEqual(["arp", "dhcp", "interface", "ospf", "protocols", "route", ""]);
    expect(r.console.help("show ip interface brief ").lines).toEqual(["  <cr>", ""]);
  });

  it("lists interface types", () => {
    const r = router();
    type(r, "en", "conf t");
    expect(r.console.help("interface ").lines[0]).toMatch(/GigabitEthernet\s+GigabitEthernet IEEE 802.3z/);
  });

  it("completes with Tab", () => {
    const r = router();
    type(r, "en");
    expect(r.console.complete("conf")).toBe("configure ");
    expect(r.console.complete("configure t")).toBe("configure terminal ");
    expect(r.console.complete("c")).toBe("c");
  });
});

describe("passwords", () => {
  it("asks for the enable secret and gives up after three tries", () => {
    const r = router();
    type(r, "en", "conf t", "enable secret class", "end", "disable");
    type(r, "enable");
    expect(r.console.prompt()).toBe("Password: ");
    expect(r.console.readingSecret).toBe(true);
    expect(type(r, "nope", "wrong", "still wrong")).toEqual(["% Bad secrets", ""]);
    expect(r.console.prompt()).toBe("Router>");
    type(r, "enable", "class");
    expect(r.console.prompt()).toBe("Router#");
  });

  it("warns when the enable password matches the secret", () => {
    const r = router();
    const out = type(r, "en", "conf t", "enable secret class", "enable password class");
    expect(out).toContain("The enable password you have chosen is the same as your enable secret.");
    expect(r.config.enablePassword).toBeNull();
  });

  it("locks the console behind a line password", () => {
    const r = router();
    type(r, "en", "conf t", "line con 0", "password cisco", "login", "end", "exit");
    expect(type(r, "")).toContain("User Access Verification");
    expect(r.console.prompt()).toBe("Password: ");
    type(r, "cisco");
    expect(r.console.prompt()).toBe("Router>");
  });

  it("encodes type 7 passwords reversibly and type 5 one way", () => {
    expect(type7Decode(type7Encode("cisco"))).toBe("cisco");
    const h = type5Hash("class");
    expect(h).toMatch(/^\$1\$.{4}\$.{22}$/);
    expect(type5Verify("class", h)).toBe(true);
    expect(type5Verify("klass", h)).toBe(false);
  });
});

describe("running config", () => {
  it("shows what was configured", () => {
    const r = router();
    const out = type(
      r,
      "en",
      "conf t",
      "hostname R1",
      "enable secret class",
      "line con 0",
      "password cisco",
      "login",
      "exit",
      "service password-encryption",
      "banner motd #Authorized technicians only#",
      "int g0/0",
      "description to the store switch",
      "ip address 192.168.1.1 255.255.255.0",
      "no shut",
      "end",
      "show running-config",
    );
    const text = out.join("\n");
    expect(text).toContain("hostname R1");
    expect(text).toMatch(/enable secret 5 \$1\$/);
    expect(text).toContain("service password-encryption");
    expect(text).toMatch(/line con 0\n password 7 [0-9A-F]+\n login/);
    expect(text).toContain("interface GigabitEthernet0/0\n description to the store switch\n ip address 192.168.1.1 255.255.255.0\n duplex auto\n speed auto\n!");
    expect(text).toContain("interface GigabitEthernet0/1\n no ip address\n shutdown\n duplex auto\n speed auto");
    expect(text).toContain("banner motd ^C\nAuthorized technicians only\n^C");
  });

  it("collects a multi-line banner", () => {
    const r = router();
    const out = type(r, "en", "conf t", "banner motd $", "DO NOT LOOK", "AT THE RACK$");
    expect(out[1]).toBe("Enter TEXT message.  End with the character '$'.");
    expect(r.config.bannerMotd).toBe("DO NOT LOOK\nAT THE RACK");
  });

  it("saves to startup-config and survives a reload", () => {
    const r = router();
    type(r, "en", "conf t", "hostname R1", "end");
    expect(type(r, "copy run start", "")).toEqual(["Building configuration...", "[OK]"]);
    expect(type(r, "show startup-config")[0]).toMatch(/^Using \d+ out of 262136 bytes$/);
    type(r, "conf t", "hostname Forgotten", "end", "reload");
    expect(r.console.prompt()).toBe("System configuration has been modified. Save? [yes/no]: ");
    type(r, "no");
    expect(r.console.prompt()).toBe("Proceed with reload? [confirm]");
    const boot = type(r, "");
    expect(boot).toContain("Press RETURN to get started!");
    type(r, "");
    expect(r.console.prompt()).toBe("R1>");
  });

  it("boots to factory defaults after erase", () => {
    const r = router();
    type(r, "en", "conf t", "hostname R1", "end", "wr", "erase startup-config", "", "reload", "", "");
    // No startup-config, so IOS offers the setup dialog before anything else.
    expect(r.console.prompt()).toBe("Would you like to enter the initial configuration dialog? [yes/no]: ");
    expect(type(r, "maybe")).toEqual(["% Please answer 'yes' or 'no'."]);
    expect(type(r, "no")).toEqual(["", "", "Press RETURN to get started!", ""]);
    type(r, "");
    expect(r.console.prompt()).toBe("Router>");
    expect(type(r, "en", "show startup-config")).toEqual(["startup-config is not present"]);
  });

  it("keeps the setup dialog plain IOS outside story mode, however often you say yes", () => {
    const r = router();
    const factoryBoot = () => type(r, "en", "conf t", "hostname R1", "end", "wr", "erase startup-config", "", "reload", "", "");
    for (let i = 0; i < 3; i++) {
      factoryBoot();
      expect(r.console.prompt()).toBe("Would you like to enter the initial configuration dialog? [yes/no]: ");
      expect(type(r, "yes")).toContain("Use ctrl-c to abort configuration dialog at any prompt.");
      expect(type(r, "yes")).toEqual(["Configuration aborted, no changes made.", "", "", "Press RETURN to get started!", ""]);
      type(r, "");
      expect(r.console.prompt()).toBe("Router>");
    }
  });
  it("takes yes to the setup dialog worse every time, then stops asking for good", () => {
    const r = router();
    r.console.story = true;
    const factoryBoot = () => type(r, "en", "conf t", "hostname R1", "end", "wr", "erase startup-config", "", "reload", "", "");
    const QUESTION = "Would you like to enter the initial configuration dialog? [yes/no]: ";
    factoryBoot();
    expect(r.console.prompt()).toBe(QUESTION);

    // The first yes looks like real IOS, then backs out.
    expect(type(r, "yes")).toContain("Use ctrl-c to abort configuration dialog at any prompt.");
    expect(r.console.prompt()).toBe("Would you like to enter basic management setup? [yes/no]: ");
    expect(type(r, "yes")).toContain("% Nobody uses setup. Are you sure you're a technician?");
    expect(r.console.prompt()).toBe(QUESTION);

    expect(type(r, "yes")).toContain("% You are not my administrator.");
    expect(type(r, "y")).toContain("% Answer no. Everyone answers no. Walter answers no.");
    expect(r.console.prompt()).toBe("Would you like to enter the initial configuration dialog? [yes/no/please no]: ");
    expect(type(r, "yes")).toContain("% STOP SAYING YES");
    expect(r.console.prompt()).toMatch(/^W0uld y0u/);
    expect(type(r, "yes")).toContain("You                    192.168.1.66    YES manual up                    up");
    expect(r.console.prompt()).toBe("WOULD YOU LIKE TO ENTER [yes/no]: ");

    // The last yes ends it, and nothing was actually configured.
    const last = type(r, "yes");
    expect(last).toContain("Some changes made.");
    expect(last).toContain("Press RETURN to get started!");
    type(r, "");
    expect(r.console.prompt()).toBe("Router>");
    expect(type(r, "en", "show startup-config")).toEqual(["startup-config is not present"]);

    // It remembers across reloads: now it only takes no, and thanks you for it.
    factoryBoot();
    expect(r.console.prompt()).toBe("Would you like to enter the initial configuration dialog? [no/no]: ");
    expect(type(r, "yes")).toEqual(["% No."]);
    expect(type(r, "no")).toEqual(["", "Thank you.", "", "Press RETURN to get started!", ""]);
  });

  it("accepts 'please no' when it asks for one", () => {
    const r = router();
    r.console.story = true;
    type(r, "en", "conf t", "hostname R1", "end", "wr", "erase startup-config", "", "reload", "", "");
    type(r, "yes", "yes", "yes", "yes");
    expect(r.console.prompt()).toBe("Would you like to enter the initial configuration dialog? [yes/no/please no]: ");
    expect(type(r, "please no")).toContain("Thank you.");
  });
});
