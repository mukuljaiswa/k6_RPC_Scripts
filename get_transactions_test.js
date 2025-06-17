import http from 'k6/http';
import { check, sleep } from 'k6';
import { htmlReport } from "https://raw.githubusercontent.com/benc-uk/k6-reporter/main/dist/bundle.js";
import { textSummary } from "https://jslib.k6.io/k6-summary/0.0.1/index.js";

// Options
export const options = {
  vus: 10,
  duration: '10s',
};

// Main test
export default function () {
  let res = http.get('https://api.devdomain123.com/api/v2/peatio/public/currencies/bdag');

  check(res, {
    'status is 200': (r) => r.status === 200
  });

  sleep(1);
}

// HTML report + stdout summary
export function handleSummary(data) {
  return {
    "/scripts/summary.html": htmlReport(data, { title: "K6 Load Test Report" }),  // <-- save in current directory
    stdout: textSummary(data, { indent: " ", enableColors: true }),
  };
}
