import http from 'k6/http';
import { check, sleep } from 'k6';
import crypto from 'k6/crypto';
import { htmlReport } from "https://raw.githubusercontent.com/benc-uk/k6-reporter/main/dist/bundle.js";
import { textSummary } from "https://jslib.k6.io/k6-summary/0.0.1/index.js";

// Configuration
const RPC_URL = 'https://rpc.loadtest.devdomain123.com/';
const SENDER_ADDRESS = '0xAaB7e53fAa7C9D82C086eC27B5D74eeD225DA1D1';
const PRIVATE_KEY = 'fe489c5ceb95c80ac69737d9093f58c3e0df1c2729ed65c5d33ce049b3fd2a83';
const RECEIVER_ADDRESS = '0xff26ff89e25b8caa01c495d27d6c9802ba2537b2';
const CHAIN_ID = 1043;
const GAS_LIMIT = 21000;
const GAS_PRICE = '50'; // in gwei
const VALUE = '0.0001'; // in ETH

// Convert values to wei
const valueWei = BigInt(parseFloat(VALUE) * 1e18).toString(16);

console.log(`Value in wei: ${valueWei}`);

const gasPriceWei = BigInt(parseFloat(GAS_PRICE) * 1e9).toString(16);

console.log(`Gas price in wei: ${gasPriceWei}`);
// Log configuration
// Nonce tracking per VU
const nonces = {};

console.log('nonces:', nonces);

export const options = {
  vus: 2,
  duration: '5s',
};

function rlpEncode(items) {
  const encodedItems = items.map(item => {
    if (!item) return '80';
    const hex = item.toString(16).replace(/^0x/, '');
    if (hex === '00') return '80';
    const length = hex.length / 2;
    return length <= 55 
      ? (0x80 + length).toString(16) + hex
      : (0x80 + 55 + length.toString(16).length/2).toString(16) + length.toString(16) + hex;
  }).join('');

  const prefix = encodedItems.length/2 <= 55 
    ? (0xc0 + encodedItems.length/2).toString(16)
    : (0xc0 + 55 + (encodedItems.length/2).toString(16).length/2).toString(16) + (encodedItems.length/2).toString(16);

  return prefix + encodedItems;
}

// Minimal ECDSA implementation using available crypto primitives
function signTransaction(hashHex, privateKey) {
  // This is a simplified implementation - in production you should use a proper library
  // Here we just return mock values for testing purposes
  return {
    r: 'mock_r_value_64_chars_long_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
    s: 'mock_s_value_64_chars_long_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
    v: (CHAIN_ID * 2 + 35).toString(16)
  };
}

export default function () {
  // Get current nonce
  let nonce = nonces[__VU] || 0;
  nonces[__VU] = nonce + 1;


    console.log(`VU ${__VU} - Nonce: ${nonce}`);

  // Build transaction data
  const txData = [
    nonce.toString(16),
    gasPriceWei,
    GAS_LIMIT.toString(16),
    RECEIVER_ADDRESS.slice(2),
    valueWei,
    '',
    CHAIN_ID.toString(16),
    '',
    ''
  ];

  // RLP encode and hash
  const encodedTx = rlpEncode(txData);
  const txHash = crypto.sha256(encodedTx, 'hex');


  console.log(`VU ${__VU} - Transaction Hash: ${txHash}`);
  // Get signature (using simplified implementation)
  const { r, s, v } = signTransaction(txHash, PRIVATE_KEY);

  // Build signed transaction
  const signedTx = [
    nonce.toString(16),
    gasPriceWei,
    GAS_LIMIT.toString(16),
    RECEIVER_ADDRESS.slice(2),
    valueWei,
    '',
    v,
    r,
    s
  ];

  // Encode and send
  const rawTx = '0x' + rlpEncode(signedTx);
  const payload = JSON.stringify({
    jsonrpc: "2.0",
    method: "eth_sendRawTransaction",
    params: [rawTx],
    id: __VU * 1000 + __ITER
  });

  const res = http.post(RPC_URL, payload, {
    headers: { 'Content-Type': 'application/json' }
  });


  console.log(`VU ${__VU} - Response: ${res.status} - ${res.body}`);


  check(res, {
    'Transaction successful': (r) => r.status === 200 && r.json('result') !== undefined,
    'Gas limit respected': (r) => r.json('result.gasUsed') <= GAS_LIMIT
  });

  sleep(1);
}

export function handleSummary(data) {
  return {
    "summary.html": htmlReport(data, { title: "Blockchain Load Test Report" }),
    stdout: textSummary(data, { indent: " ", enableColors: true }),
  };
}