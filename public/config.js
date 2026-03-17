// Runtime configuration — override for production deployment
window.__CONSOLE_CONFIG__ = {
  apiBaseUrl: "http://localhost:8000/api/v1",
  environment: "development",
  // posthogKey: "phc_...",
  // posthogHost: "https://us.i.posthog.com",
  // grafana: {
  //   baseUrl: "https://aha.grafana.net",
  //   panels: [
  //     { title: "Request Latency", src: "https://aha.grafana.net/d-solo/...", height: 300 }
  //   ]
  // }
};
