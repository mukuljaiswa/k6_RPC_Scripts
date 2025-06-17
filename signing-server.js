require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const { Web3 } = require('web3');
const { HttpProvider } = require('web3-providers-http');

const app = express();
const port = 3000;

app.use(bodyParser.json());

// Configuration from .env with defaults
const config = {
    RPC_URL: process.env.RPC_URL || 'https://rpc.bdagscan.com/',
    GAS: parseInt(process.env.GAS_LIMIT) || 21000,
    GAS_PRICE: process.env.GAS_PRICE || '50', // in Gwei
    DEFAULT_AMOUNT_ETHER: process.env.DEFAULT_AMOUNT_ETHER || '0.0001'
};

const web3 = new Web3(new HttpProvider(config.RPC_URL));
const nonceTracker = {};

app.post('/sign', async (req, res) => {
    try {
        const { receiver, amountEther = config.DEFAULT_AMOUNT_ETHER, sender } = req.body;


        console.log("request body----->", req.body);



    

        
        if (!sender?.address || !sender?.privateKey) {
            throw new Error('Invalid sender wallet provided');
        }
        if (!receiver) {
            throw new Error('Receiver address required');
        }



        console.log("sender----->", req.body.sender);

        const nonce = nonceTracker[sender.address] = 
            (nonceTracker[sender.address] ?? await web3.eth.getTransactionCount(sender.address, 'pending')) + 1;

        console.log("nonce----->", nonce);

        const tx = {
            to: receiver,
            value: web3.utils.toWei(amountEther, 'ether'),
            gas: config.GAS,
            gasPrice: web3.utils.toWei(config.GAS_PRICE, 'gwei'),
            nonce
        };

        const signedTx = await web3.eth.accounts.signTransaction(tx, sender.privateKey);

        console.log("signedTx----->", signedTx);

        res.json({ rawTransaction: signedTx.rawTransaction });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.listen(port, () => {
    console.log('🚀 Signing server configuration:');
    console.log(config);
    console.log(`Server running at http://localhost:${port}`);
});