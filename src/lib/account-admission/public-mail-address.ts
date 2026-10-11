import { BlockList, isIP } from "node:net";

const denied = new BlockList();

for (const [network, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.168.0.0", 16],
  ["192.88.99.0", 24],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 3],
] as const) {
  denied.addSubnet(network, prefix, "ipv4");
}

denied.addSubnet("2001:db8::", 32, "ipv6");
denied.addSubnet("2001::", 23, "ipv6");
denied.addSubnet("2002::", 16, "ipv6");
denied.addSubnet("3fff::", 20, "ipv6");

export function isPublicMailAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return !denied.check(address, "ipv4");
  if (family === 6) {
    const first = Number.parseInt(address.split(":")[0] ?? "", 16);
    return (
      first >= 0x2000 &&
      first <= 0x3fff &&
      !denied.check(address, "ipv6")
    );
  }
  return false;
}
