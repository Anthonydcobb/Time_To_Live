# IPv4 ACL research

Captured 2026-10-23 from the headless simulator and Packet Tracer's live bridge. IOS 15 documentation is authoritative; PT is recorded as a platform observation. The PT router is a Cisco 2911 running IOS 15.1(4)M4. The test used the existing PC0 VLAN 10 and PC1 VLAN 20 path through Router0's subinterfaces. No cables or devices were added. Raw command captures are in [PT](../harness/artifacts/acls-research-pt.json) and [sim](../harness/artifacts/acls-research-sim.json).

The PT harness removed its numbered and named ACLs, interface bindings and VTY access-class, then verified `show access-lists` was empty and both router subinterfaces had no inbound or outbound ACL. The PC IP configuration was captured again. Some PC bridge responses include older terminal history; the ACL test responses themselves include the current ping and destination-unreachable result, and `show access-lists` records matches on the deny entries. The simulator harness uses an ephemeral network; it records that named ACL deletion is unsupported before discarding that network.

## Priority fix list

1. **Add packet-match counters to `show access-lists` (`sim-wrong`).** PT displayed `(3 match(es))` on numbered standard ACL 10 and `(1 match(es))` on extended ACL 101 and both named ACL deny entries after traffic. The simulator displayed the ACL statements without a match count. Cisco IOS 15 documents per-entry counters and their display through `show access-lists`. [Cisco IOS 15 ACL statistics guide](https://www.cisco.com/c/en/us/td/docs/ios-xml/ios/sec_data_acl/configuration/15-sy/sec-data-acl-15-sy-book/sec-dply-clr-ald-acl.html)

2. **Accept IOS `host` operands in numbered and named ACL rules (`sim-wrong`).** The sim rejected commands such as `access-list 10 deny host 192.168.10.10` and `deny icmp host 192.168.10.10 host 192.168.20.10` in named extended mode. The equivalent source/destination addresses without `host` were accepted and enforced, so standard/extended matching itself works. PT accepted the `host` forms and showed them in its ACL output. IOS documents the `host` address form for ACL entries. [Cisco IOS 15 ACL configuration guide](https://www.cisco.com/c/en/us/td/docs/ios-xml/ios/sec_data_acl/configuration/15-sy/sec-data-acl-15-sy-book/sec-create-ip-apply.html)

3. **Implement VTY `access-class` in line configuration (`sim-wrong`).** The sim rejected both `access-class VTY-MGMT in` and `access-class 12 in`, and its VTY Telnet command is unavailable. PT accepted and displayed the numbered form under `line vty 0 4`. Cisco IOS 15 requires a numbered ACL for VTY access; PT also accepted the named ACL form, which is a `pt-limitation` relative to IOS. The PC Telnet attempt returned `Connection refused by remote host`, so whether the VTY ACL itself filters the session remains `needs-cml`. [Cisco IOS 15 VTY access guide](https://www.cisco.com/c/en/us/td/docs/ios-xml/ios/sec_data_acl/configuration/15-mt/sec-data-acl-15-mt-book/sec-cntrl-acc-vtl.html)

4. **Support removal of named IPv4 ACLs (`sim-wrong`, lower priority).** The simulator rejected `no ip access-list standard TTL-STANDARD` and the equivalent extended form. PT accepted those commands during cleanup. This did not leave PT state behind; the sim harness discarded its temporary network.

## Captured behavior

| Behavior | Packet Tracer / IOS 15 observation | Simulator observation | Classification |
|---|---|---|---|
| Numbered standard ACL | ACL 10 deny host `192.168.10.10`, permit any; attached outbound on Gi0/0.20. The ping reached Router0 and the deny ACE showed matches. | Standard numbered ACL and outbound attachment worked with the address written without `host`; ping was denied. | Match for tested form; `host` syntax is `sim-wrong` |
| Implicit deny | ACL 11 permitted only host `192.168.10.11`; PC0 traffic was denied and the unmatched permit entry had no match count. No explicit deny ACE was displayed. | Same rule and attachment denied PC0 traffic; no explicit implicit-deny ACE is printed. | Match |
| Numbered extended ACL | ACL 101 denied ICMP from PC0 to PC1 and permitted other IP; inbound on Gi0/0.10. The deny entry showed a match. | Extended match and inbound interface attachment worked with address operands without `host`; no counters were displayed. | `sim-wrong` for host syntax and counters |
| Named standard and extended ACLs | Both named types configured, attached in their selected directions, displayed with ACEs, and counted matching denies. | Both types configured and attached, but `host` ACE syntax and named-list removal were rejected; counters were absent. | `sim-wrong` |
| Interface direction | `show ip interface` reported `Outgoing access list is 10` and `Inbound access list is 101` on the configured subinterfaces. | The interface view reported the corresponding inbound/outbound ACL names. | Match |
| Hit counters | Deny ACEs showed match counts after ACL traffic. | ACL entries appeared without counters. | `sim-wrong` |
| VTY numbered access-class | PT accepted ACL 12 under `line vty 0 4` and showed it in running-config. A Telnet attempt returned “Connection refused by remote host,” which did not isolate ACL filtering. | Both named and numbered `access-class` commands were rejected; Telnet is unavailable. | `sim-wrong` command support; enforcement `needs-cml` |
| Named VTY ACL | PT accepted and displayed a named access-class. | Named access-class rejected. | `pt-limitation`: IOS 15 documentation specifies a numbered ACL for VTY access |

## Sources

- [Cisco IOS 15SY ACL configuration and interface application](https://www.cisco.com/c/en/us/td/docs/ios-xml/ios/sec_data_acl/configuration/15-sy/sec-data-acl-15-sy-book/sec-create-ip-apply.html) — numbered and named ACLs, address matching, implicit deny and inbound/outbound application.
- [Cisco IOS 15SY ACL statistics](https://www.cisco.com/c/en/us/td/docs/ios-xml/ios/sec_data_acl/configuration/15-sy/sec-data-acl-15-sy-book/sec-dply-clr-ald-acl.html) — per-entry matches and `show access-lists` counters.
- [Cisco IOS 15M&T VTY access control](https://www.cisco.com/c/en/us/td/docs/ios-xml/ios/sec_data_acl/configuration/15-mt/sec-data-acl-15-mt-book/sec-cntrl-acc-vtl.html) — `access-class` behavior and numbered-ACL requirement.
