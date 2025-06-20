import http from 'k6/http';
import { check, sleep, group } from 'k6';
import { htmlReport } from "https://raw.githubusercontent.com/benc-uk/k6-reporter/main/dist/bundle.js";
import { textSummary } from "https://jslib.k6.io/k6-summary/0.0.1/index.js";
import { SharedArray } from 'k6/data';
import { Counter } from 'k6/metrics';

// Custom counter
export const requestCounter = new Counter('custom_http_reqs');

// Config
const config = {
    signServer: __ENV.SIGN_SERVER || 'http://localhost:3000/sign',
    senderPath: __ENV.SENDER_WALLETS_PATH || './wallets/output_part_1.json',
    receiverPath: __ENV.RECEIVER_WALLETS_PATH || './wallets/output_part_2.json'
};

// Load senders and receivers
const senders = new SharedArray('senders', () => JSON.parse(open(config.senderPath)));

const receivers = new SharedArray('receivers', () => {
    const data = JSON.parse(open(config.receiverPath));
    return data.map(w => typeof w === 'string' ? w : w.address);
});

export default function () {
    const vuID = __VU;
    const iter = __ITER;
    const TOTAL_VUS = 50;

    const senderIndex = (iter * TOTAL_VUS + (vuID - 1)) % senders.length;
    const receiverIndex = (iter + vuID) % receivers.length;

    const sender = {
        ...senders[senderIndex],
        amountEther: '0.0001'
    };
    const receiver = receivers[receiverIndex];

    const txData = {
        receiver,
        amountEther: sender.amountEther,
        sender: {
            address: sender.address,
            privateKey: String(sender.privateKey)
        }
    };

    group("BlockDAG RPC Call", function () {
        const res = http.post(config.signServer, JSON.stringify(txData), {
            headers: { 'Content-Type': 'application/json' },
            tags: { name: '' }
        });

        requestCounter.add(1);

        const txHash = JSON.parse(res.body).result;
        console.log(`VU: ${vuID}, Iteration: ${iter}, Sender: ${sender.address}, Receiver: ${receiver}, Status: ${res.status}, Transaction Hash: ${txHash}`);

        check(res, {
            'status is 200': (r) => r.status === 200,
        });
    });

    sleep(1);
}

export let options = {
    scenarios: {
        ramp_up_and_down: {
            executor: 'ramping-vus',
            startVUs: 0,
            stages: [
                // Ramp up to 120 VUs in 12 seconds (10 VUs per second)
                { duration: '30s', target: 50 },
                // Stay at 120 VUs for 2 minutes
                { duration: '6m', target: 50 },
                // Ramp down to 0 VUs in 15 seconds
                { duration: '30s', target: 0 }
            ],
            gracefulRampDown: '15s',
        },
    },
    // You might want to adjust these thresholds based on your requirements
    // thresholds: {
    //     http_req_duration: ['p(95)<500'], // 95% of requests should complete within 500ms
    //     'custom_http_reqs': ['count>=1200'], // Expect at least 1200 requests (adjust as needed)
    // },
};

// HTML + stdout summary
export function handleSummary(data) {
    // Generate current UTC timestamp
    const now = new Date();
    const timestamp = now.toISOString().replace(/[:.]/g, '-');
    
    return {
        [`./k6_html_Reports/blockdag_load_test_${timestamp}.html`]: htmlReport(data, { title: "BlockDAG RPC K6 Load Test Report" }),
        stdout: textSummary(data, { indent: " ", enableColors: true }),
    };
}