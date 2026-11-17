import dns from "node:dns";
import net from "node:net";

// Must be imported first so ESM evaluation locks IPv4-first & disables Happy Eyeballs
// before any database, HTTP, or Telegram Bot modules initialize.
dns.setDefaultResultOrder("ipv4first");
if (typeof net.setDefaultAutoSelectFamily === "function") {
  net.setDefaultAutoSelectFamily(false);
}
