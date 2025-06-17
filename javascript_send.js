const { Web3 } = require('web3');
const { HttpProvider } = require('web3-providers-http');
const axios = require('axios');

const INFURA_URL = 'https://rpc.loadtest.devdomain123.com/';
const web3 = new Web3(new HttpProvider(INFURA_URL));

const senderWallet = {
    address: '0xAaB7e53fAa7C9D82C086eC27B5D74eeD225DA1D1',
    privateKey: '0xfe489c5ceb95c80ac69737d9093f58c3e0df1c2729ed65c5d33ce049b3fd2a83'
};

const receiverAddress = '0xff26ff89e25b8caa01c495d27d6c9802ba2537b2';
const ETHER_VALUE = '0.0001';
const GAS = 21000;
const GAS_PRICE = '50';
const CHAIN_ID = 1043;

const nonceTracker = {};

async function sendTransaction() {
    try {
        const sender = senderWallet.address
        const receiver = receiverAddress;


        // Nonce management
        let nonce = nonceTracker[sender];
        if (nonce === undefined) {
            nonce = Number(await web3.eth.getTransactionCount(sender, 'pending'));  // Force Number
        }
        nonceTracker[sender] = nonce + 1;

        const valueInWei = BigInt(web3.utils.toWei(ETHER_VALUE, 'ether'));
        const gasLimit = BigInt(GAS);
        const gasPriceInWei = BigInt(web3.utils.toWei(GAS_PRICE, 'gwei'));

        const tx = {
            to: receiver,
            value: valueInWei,
            gas: gasLimit,
            gasPrice: gasPriceInWei,
            nonce: nonce,
            chainId: CHAIN_ID
        };

        const signedTx = await web3.eth.accounts.signTransaction(tx, senderWallet.privateKey);
        const rawTxHex = signedTx.rawTransaction;

        const response = await axios.post(INFURA_URL, {
            jsonrpc: "2.0",
            method: "eth_sendRawTransaction",
            params: [rawTxHex],
            id: Date.now()
        }, {
            headers: {
                'Content-Type': 'application/json'
            }
        });

        if (response.data.error) {
            console.error("❌ RPC Error:", response.data.error.message);
        } else {
            console.log("✅ Transaction sent successfully!");
            console.log("📦 Transaction Hash:", response.data.result);
        }

    } catch (err) {
        console.error("❌ Exception:", err.message || err);
    }
}

sendTransaction();
