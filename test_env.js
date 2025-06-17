import exec from 'k6/execution';

export default function() {
    console.log("SENDER_WALLETS_PATH:", __ENV.SENDER_WALLETS_PATH || "Not found");
    console.log("RECEIVER_WALLETS_PATH:", __ENV.RECEIVER_WALLETS_PATH || "Not found");
}
