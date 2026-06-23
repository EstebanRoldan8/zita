export function startKeepAlive() {
  setInterval(() => {
    fetch('/api/ping').catch(() => {});
  }, 4 * 60 * 1000);
}
