# CCNA coverage matrix

This is the current study-lab boundary for the simulator and Packet Tracer
dashboard. The simulator is the authoritative deterministic test environment;
Packet Tracer is used for IOS/topology observations when its ExApp is connected.

## Hands-on simulator coverage

These topics have executable behavior and regression tests, not just config
text:

- IOS modes, abbreviations, help, completion, passwords, save/reload, banners,
  console/VTY settings, and realistic parser errors.
- Ethernet cabling, link negotiation, line protocol, speed/duplex settings,
  forced negotiation faults, packet/octet counters, CRC/input/output errors,
  ARP, MAC learning, ICMP, ping, and traceroute.
- IPv4/IPv6 addressing, connected/local/static routes, administrative distance,
  longest-prefix match, default gateways, IPv6 neighbor discovery, and TTL or
  hop-limit failures.
- VLANs, access/trunk ports, native and allowed VLANs, DTP, router-on-a-stick,
  SVIs, voice VLAN configuration, VTP, STP/PVST roles and reconvergence,
  PortFast, BPDU Guard, EtherChannel, and Layer-3 switching.
- CDP, LLDP, DHCP server/client/relay, DNS host records, OSPF, EIGRP, OSPFv3,
  ACL enforcement, NAT/PAT, HSRP, VRRP, GLBP, port security, DHCP snooping,
  Dynamic ARP Inspection, NTP state, syslog buffering, and simulated SNMP GET.
- PC console sessions and authenticated simulated SSH/Telnet sessions. These
  reuse the simulator CLI rather than opening real TCP sockets.

Representative regression suites are `tests/network.test.ts`,
`tests/vlans.test.ts`, `tests/stp.test.ts`, `tests/ospf.test.ts`,
`tests/eigrp.test.ts`, `tests/ipv6.test.ts`, `tests/acl.test.ts`,
`tests/nat.test.ts`, `tests/hsrp.test.ts`, `tests/dhcp.test.ts`,
`tests/operations.test.ts`, and `tests/remote-access.test.ts`.

## Dashboard and Packet Tracer coverage

The dashboard can discover devices and link endpoints through the local bridge,
hide Packet Tracer power-distribution devices from the operational topology,
run IOS/PC commands, show command history, run expanded-lab health checks, and
display failed-check command evidence. Health includes VLAN/trunk/routing,
IPv6, NAT, gateway redundancy, services, access-layer security, physical link
status, negotiated speed/duplex, and interface error counters.

The bridge health response distinguishes the Node queue from the Java ExApp:
`ok` means the HTTP bridge is alive, while `pollerConnected` means the ExApp has
polled the queue within the last three seconds. A queued command with no result
is therefore diagnosable instead of appearing as a generic dashboard outage.

## Intentionally simplified or concept-only

These are study concepts or deliberately bounded approximations rather than
claims of production fidelity:

- Wireless RF interference, coverage, roaming, and controller behavior.
- Production QoS under congestion, including hardware queuing and shaping.
- Full SNMP polling/traps/informs and a centralized syslog collector.
- Cloud-managed networking, controller APIs, and production REST automation.
- RADIUS/TACACS+ server exchanges; AAA local authentication is modeled.
- SSH/Telnet transport encryption and socket behavior; authentication and the
  session CLI are modeled through the simulator API.
- Physical optics/transceivers, real cable faults, and vendor-specific hardware
  differences. Packet Tracer remains a reference source, not a replacement for
  CML or real hardware.

For these items, the required outcome is conceptual recognition, correct
terminology, and troubleshooting interpretation—not pretending that a local
simulation proves production behavior.

## Verification commands

For the complete local simulator gate, run `npm run verify:network`. It runs
the build, all tests, every repeatable topology/fault scenario below, and an
artifact audit that checks each scenario produced populated JSON evidence.

```powershell
npm test -- --run
npm run build
node tools/run-sim-spike.mjs
node tools/run-sim-fault-scenarios.mjs
node tools/run-sim-stp-scenario.mjs
node tools/run-sim-ipv6-scenario.mjs
node tools/run-sim-ipv6-ospf.mjs
node tools/run-sim-dhcp-scenario.mjs
node tools/run-sim-nat-scenario.mjs
node tools/run-sim-acl-scenario.mjs
node tools/run-sim-routing-scenario.mjs
node tools/run-sim-services-scenario.mjs
npm run audit:network
node tools/run-pt-adapter-spike.mjs
```

The first five are local checks. The simulator fault runner writes
`harness/artifacts/sim-fault-scenarios.json` with before/during/after evidence
for an access-port shutdown and a forced speed mismatch. The Packet Tracer adapter command requires
Packet Tracer's Java ExApp to be connected and polling the bridge.
The STP runner writes `harness/artifacts/sim-stp-scenario.json` with raw
`show spanning-tree` output before, during, and after a root-link failure.
The IPv6 runner writes `harness/artifacts/sim-ipv6-scenario.json` with an
IPv6 ping, neighbor-discovery output, and a topology snapshot.
The OSPFv3 runner writes `harness/artifacts/sim-ipv6-ospf.json` with the
adjacency, learned route, and end-to-end IPv6 ping.
The DHCP runner writes `harness/artifacts/sim-dhcp-scenario.json` with the
PC lease, excluded-range validation, binding table, and topology snapshot.
The NAT runner writes `harness/artifacts/sim-nat-scenario.json` with inbound
static translation, outbound reachability, translations, and statistics.
The ACL runner writes `harness/artifacts/sim-acl-scenario.json` with baseline
reachability, an applied ICMP deny, ACL output, and restored reachability.
The routing runner writes `harness/artifacts/sim-routing-scenario.json` with
EIGRP adjacency and learned-route evidence plus HSRP active-gateway failover.
The services runner writes `harness/artifacts/sim-services-scenario.json` with
DNS, NTP, syslog, SNMP, SSH, and management-LAN verification evidence.
