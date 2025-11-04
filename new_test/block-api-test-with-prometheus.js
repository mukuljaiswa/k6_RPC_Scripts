// block-api-test-with-prometheus.js
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Counter, Rate, Trend, Gauge } from 'k6/metrics';

// ==================== PROMETHEUS METRICS ====================
// These custom metrics will be exported to Prometheus
const prometheusMetrics = {
  // Counter: total number of requests
  requestCounter: new Counter('block_api_requests_total'),
  
  // Rate: error rate (0-1)
  errorRate: new Rate('block_api_error_rate'),
  
  // Trend: track response times for percentiles
  responseTime: new Trend('block_api_response_time_ms'),
  
  // Gauge: current active users
  activeUsers: new Gauge('block_api_active_users'),
  
  // Counter: track data throughput
  dataReceived: new Counter('block_api_data_received_bytes'),
};

export const options = {
  stages: [
    { duration: '5s', target: 10 },
    { duration: '20s', target: 10 },
    { duration: '5s', target: 0 },
  ],
  thresholds: {
    http_req_duration: ['p(95)<2000'],
    http_req_failed: ['rate<0.01'],
    // Prometheus-specific thresholds
    'block_api_error_rate': ['rate<0.05'],
    'block_api_response_time_ms': ['p(95)<1500'],
  },
};

export default function () {
  // ==================== PROMETHEUS: Track active users ====================
  prometheusMetrics.activeUsers.add(1);
  
  const url = 'https://api-explorer.devdomain123.com/v1/api/block/getSafeBlockDetails';
  const params = {
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': 'k6-load-test/1.0',
    },
  };

  // ==================== PROMETHEUS: Track request start time ====================
  const startTime = Date.now();
  
  const response = http.get(url, params);
  
  // ==================== PROMETHEUS: Calculate and track response time ====================
  const responseTime = Date.now() - startTime;
  prometheusMetrics.responseTime.add(responseTime);
  
  // ==================== PROMETHEUS: Increment request counter ====================
  prometheusMetrics.requestCounter.add(1);
  
  // ==================== PROMETHEUS: Track data volume ====================
  prometheusMetrics.dataReceived.add(response.body.length);

  // Check if the request was successful
  const isSuccess = check(response, {
    'status is 200': (r) => r.status === 200,
    'response time < 5s': (r) => r.timings.duration < 5000,
    'has response body': (r) => r.body.length > 0,
  });

  // ==================== PROMETHEUS: Track errors ====================
  if (!isSuccess) {
    prometheusMetrics.errorRate.add(1);
  } else {
    prometheusMetrics.errorRate.add(0);
  }

  // Optional: Parse and validate JSON response
  if (response.status === 200) {
    try {
      const jsonData = response.json();
      check(jsonData, {
        'response has valid JSON': (j) => j !== null,
      });
    } catch (e) {
      console.log('JSON parse error:', e.message);
      prometheusMetrics.errorRate.add(1);
    }
  }

  // ==================== PROMETHEUS: Decrement active users ====================
  prometheusMetrics.activeUsers.add(-1);
  
  sleep(1);
}