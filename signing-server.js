require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const { Web3 } = require('web3');
const { HttpProvider } = require('web3-providers-http');
const axios = require('axios');
const { logTransaction } = require('./transaction-logger');

const app = express();
const port = 3000;

app.use(bodyParser.json());

const config = {
    RPC_URL: process.env.RPC_URL || 'http://localhost:8545',
    GAS: parseInt(process.env.GAS_LIMIT) || 21000,
    GAS_PRICE: process.env.GAS_PRICE || '50',
    DEFAULT_AMOUNT_ETHER: process.env.DEFAULT_AMOUNT_ETHER || '0.0001'
};

const web3 = new Web3(new HttpProvider(config.RPC_URL));
const nonceTracker = {};

app.post('/sign', async (req, res) => {
    try {
        const { receiver, amountEther = config.DEFAULT_AMOUNT_ETHER, sender } = req.body;

        if (!sender?.address || !sender?.privateKey) {
            throw new Error('Invalid sender wallet provided');
        }
        if (!receiver) {
            throw new Error('Receiver address required');
        }

        // Get current nonce (either from tracker or blockchain)
        const currentNonce = nonceTracker[sender.address] ?? await web3.eth.getTransactionCount(sender.address, 'pending');

        console.log('Nonce tracker:', nonceTracker);
        
        const tx = {
            to: receiver,
            value: web3.utils.toWei(amountEther, 'ether'),
            gas: config.GAS,
            gasPrice: web3.utils.toWei(config.GAS_PRICE, 'gwei'),
            nonce: currentNonce
        };

        const signedTx = await web3.eth.accounts.signTransaction(tx, sender.privateKey);

        const rpcResponse = await axios.post(config.RPC_URL, {
            jsonrpc: '2.0',
            method: 'eth_sendRawTransaction',
            params: [signedTx.rawTransaction],
            id: 1
        });

        // Only increment nonce if transaction was successfully submitted
        if (rpcResponse.status === 200) {
            nonceTracker[sender.address] = BigInt(currentNonce) + BigInt(1);
            console.log('Nonce incremented to:', nonceTracker[sender.address]);
        } else {
            throw new Error('Transaction submission failed');
        }

        await logTransaction({
            senderAddress: sender.address,
            transactionHash: rpcResponse.data.result,
            status: rpcResponse.status,
            nonce: currentNonce.toString()
        });

        res.json(rpcResponse.data);

    } catch (err) {
        console.error("Error:", err);
        res.status(500).json({ 
            error: err.message,
            ...(err.response?.data && { rpcError: err.response.data })
        });
    }
});

app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
});