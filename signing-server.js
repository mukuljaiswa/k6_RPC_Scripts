require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const { Web3 } = require('web3');
const { HttpProvider } = require('web3-providers-http');
const app = express();
const port = 3000;

app.use(bodyParser.json());

const config = {
  RPC_URL: process.env.RPC_URL || 'https://rpc.loadtest.devdomain123.com/',
  GAS: parseInt(process.env.GAS_LIMIT) || 30000, // Increased from 21000
  GAS_PRICE: process.env.GAS_PRICE || '50',
  DEFAULT_AMOUNT_ETHER: process.env.DEFAULT_AMOUNT_ETHER || '0.0001'
};

const web3 = new Web3(new HttpProvider(config.RPC_URL));
const nonceTracker = {};

// Helper to get proper nonce
async function getNonce(address) {
  try {
    // Always get the latest nonce from blockchain for accuracy
    const blockchainNonce = await web3.eth.getTransactionCount(address, 'pending');
    
    if (nonceTracker[address] === undefined) {
      nonceTracker[address] = BigInt(blockchainNonce);
    } else {
      // Use the higher of tracked nonce or blockchain nonce
      const trackedNonce = nonceTracker[address];
      if (BigInt(blockchainNonce) > trackedNonce) {
        nonceTracker[address] = BigInt(blockchainNonce);
      }
    }
    
    return nonceTracker[address];
  } catch (error) {
    console.error(`Error getting nonce for ${address}:`, error);
    throw error;
  }
}

app.post('/sign', async (req, res) => {
  try {
    const { receiver, amountEther = config.DEFAULT_AMOUNT_ETHER, sender } = req.body;
    
    if (!sender?.address || !sender?.privateKey) {
      throw new Error('Invalid sender wallet provided');
    }
    
    if (!receiver) {
      throw new Error('Receiver address required');
    }

    // Validate addresses
    if (!web3.utils.isAddress(sender.address)) {
      throw new Error('Invalid sender address');
    }
    
    if (!web3.utils.isAddress(receiver.address)) {
      throw new Error('Invalid receiver address');
    }

    // Get proper nonce
    const currentNonce = await getNonce(sender.address);
    
    const tx = {
      to: receiver.address,
      value: web3.utils.toWei(amountEther, 'ether'),
      gas: config.GAS,
      gasPrice: web3.utils.toWei(config.GAS_PRICE, 'gwei'),
      nonce: Number(currentNonce) // Convert BigInt to Number for transaction
    };

    console.log(`Creating transaction for ${sender.address}:`, {
      to: receiver.address,
      nonce: Number(currentNonce),
      value: amountEther
    });

    const signedTx = await web3.eth.accounts.signTransaction(tx, sender.privateKey);
    
    console.log("Signed Transaction Details:", {
      from: sender.address,
      to: receiver.address,
      transactionHash: signedTx.transactionHash,
      nonce: Number(currentNonce)
    });

    // Update nonce tracker
    nonceTracker[sender.address] = currentNonce + BigInt(1);
    
    res.json({
      signedTx: signedTx.rawTransaction,
      nonce: Number(currentNonce).toString(),
      transactionHash: signedTx.transactionHash // Also return the expected hash
    });
    
  } catch (err) {
    console.error("Signing Error:", err);
    res.status(500).json({ 
      error: err.message,
      details: err.stack
    });
  }
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.listen(port, () => {
  console.log(`Signing server running at http://localhost:${port}`);
});