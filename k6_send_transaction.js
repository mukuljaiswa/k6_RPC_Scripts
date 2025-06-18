import http from 'k6/http';
import { check, sleep } from 'k6';
import { SharedArray } from 'k6/data';

// Config
const config = {
    signServer: __ENV.SIGN_SERVER || 'http://localhost:3000/sign',
    senderPath: __ENV.SENDER_WALLETS_PATH || './wallets/output_part_1.json',
    receiverPath: __ENV.RECEIVER_WALLETS_PATH || './wallets/output_part_2.json'
};

// Shared sender and receiver data
const senders = new SharedArray('senders', () => {
    return JSON.parse(open(config.senderPath));
});

const receivers = new SharedArray('receivers', () => {
    const data = JSON.parse(open(config.receiverPath));
    return data.map(w => typeof w === 'string' ? w : w.address);
});

export default function () {
    const vuID = __VU;
    const iter = __ITER;

    // Total VUs assumed (static or manually controlled)
    const TOTAL_VUS = 5;

    // Deterministic sender per VU, rotated by iteration
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

    const res = http.post(config.signServer, JSON.stringify(txData), {
        headers: { 'Content-Type': 'application/json' }
    });

    const txHash = JSON.parse(res.body).result;
    console.log(`VU: ${vuID}, Iteration: ${iter}, Sender: ${sender.address}, Receiver: ${receiver}, Status: ${res.status}, Transaction Hash: ${txHash}`);

    check(res, {
        'status is 200': (r) => r.status === 200,
        'has result': (r) => !!r.json('result')
    });

    sleep(1);
}

export let options = {
    scenarios: {
        constant_vus: {
            executor: 'constant-vus',
            vus: 5,
            duration: '30s',
        },
    },
};
