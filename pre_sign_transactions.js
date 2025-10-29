// presign_transactions.js
// Run with: node presign_transactions.js

const { ethers } = require('ethers');
const fs = require('fs');

// Configuration
const config = {
  senderPath: './wallets/output_part_1 copy.json',
  receiverPath: './wallets/output_part_2.json',
  outputPath: './presigned_transactions.json',
  rpcUrl: 'https://rpc.loadtest.devdomain123.com/',
  chainId: 1043, // 0x413 in decimal
  gasLimit: 30000,
  gasPriceGwei: '50',
  amountEther: '0.0001',
  batchSize: 100, // Number of transactions to pre-sign per sender
};

async function main() {
  console.log('=== Transaction Pre-signing Tool ===\n');
  
  // Load wallets
  console.log('Loading wallets...');
  const senders = JSON.parse(fs.readFileSync(config.senderPath, 'utf8'));
  const receivers = JSON.parse(fs.readFileSync(config.receiverPath, 'utf8'));
  
  console.log(`Loaded ${senders.length} senders and ${receivers.length} receivers`);
  
  // Connect to RPC to get current nonces
  const provider = new ethers.JsonRpcProvider(config.rpcUrl);
  
  const presignedTxs = [];
  let totalSigned = 0;
  
  console.log('\nPre-signing transactions...');
  
  for (let i = 0; i < senders.length; i++) {
    const sender = senders[i];
    
    try {
      // Create wallet from private key
      let privateKey = sender.privateKey;
      if (!privateKey.startsWith('0x')) {
        privateKey = '0x' + privateKey;
      }
      
      const wallet = new ethers.Wallet(privateKey, provider);
      
      // Verify address matches
      if (wallet.address.toLowerCase() !== sender.address.toLowerCase()) {
        console.error(`Address mismatch for sender ${i}: expected ${sender.address}, got ${wallet.address}`);
        continue;
      }
      
      // Get current nonce
      let startNonce;
      try {
        startNonce = await provider.getTransactionCount(wallet.address, 'pending');
      } catch (error) {
        console.warn(`Failed to get nonce for ${wallet.address}, using 0`);
        startNonce = 0;
      }
      
      // Pre-sign multiple transactions for this sender
      for (let j = 0; j < config.batchSize; j++) {
        const receiverIndex = (i + j) % receivers.length;
        const receiver = receivers[receiverIndex];
        const receiverAddress = receiver.address || receiver;
        
        const tx = {
          to: receiverAddress,
          value: ethers.parseEther(config.amountEther),
          gasLimit: config.gasLimit,
          gasPrice: ethers.parseUnits(config.gasPriceGwei, 'gwei'),
          nonce: startNonce + j,
          chainId: config.chainId,
        };
        
        // Sign transaction
        const signedTx = await wallet.signTransaction(tx);
        
        presignedTxs.push({
          from: wallet.address,
          to: receiverAddress,
          nonce: startNonce + j,
          signedTx: signedTx,
          value: config.amountEther,
          gasPrice: config.gasPriceGwei,
        });
        
        totalSigned++;
      }
      
      if ((i + 1) % 100 === 0) {
        console.log(`Progress: ${i + 1}/${senders.length} senders processed (${totalSigned} transactions signed)`);
      }
      
    } catch (error) {
      console.error(`Error processing sender ${i} (${sender.address}):`, error.message);
    }
  }
  
  // Save to file
  console.log(`\nSaving ${presignedTxs.length} pre-signed transactions to ${config.outputPath}...`);
  fs.writeFileSync(config.outputPath, JSON.stringify(presignedTxs, null, 2));
  
  console.log('\n=== Summary ===');
  console.log(`Total senders processed: ${senders.length}`);
  console.log(`Total transactions pre-signed: ${presignedTxs.length}`);
  console.log(`Transactions per sender: ${config.batchSize}`);
  console.log(`Output file: ${config.outputPath}`);
  console.log(`File size: ${(fs.statSync(config.outputPath).size / 1024 / 1024).toFixed(2)} MB`);
  console.log('\nDone! You can now use these transactions in k6.');
}

main().catch(console.error);