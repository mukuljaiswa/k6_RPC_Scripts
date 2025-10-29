// CSV Logger that collects data per VU and combines in summary
class CSVLogger {
    constructor() {
      this.filename = this.generateFilename();
      this.vuData = new Map(); // Store data per VU
      
      console.log(`CSV Logger initialized for VU:${__VU}`);
    }
  
    generateFilename() {
      const now = new Date();
      const timestamp = now.toISOString().replace(/[:.]/g, '-').split('.')[0];
      return `transaction_results_${timestamp}.csv`;
    }
  
    logTransaction(data) {
      console.log(`📝 VU:${__VU} - Recording transaction - Sender: ${data.senderAddress}`);
      
      // Store transaction in this VU's data
      if (!this.vuData.has(__VU)) {
        this.vuData.set(__VU, []);
      }
      
      const vuTransactions = this.vuData.get(__VU);
      vuTransactions.push({
        timestamp: new Date().toISOString(),
        senderAddress: data.senderAddress,
        transactionHash: data.transactionHash,
        status: data.status,
        nonce: data.nonce
      });
      
      console.log(`✅ VU:${__VU} - Transaction recorded. VU ${__VU} total: ${vuTransactions.length}`);
    }
  
    // This method will be called by handleSummary to get all data
    getAllTransactions() {
      let allTransactions = [];
      
      // Collect transactions from all VUs
      for (const [vuId, transactions] of this.vuData) {
        allTransactions = allTransactions.concat(transactions);
      }
      
      // Sort by timestamp
      allTransactions.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
      return allTransactions;
    }
  
    generateCSV() {
      const allTransactions = this.getAllTransactions();
      if (allTransactions.length === 0) {
        return null;
      }
      
      let csv = 'Timestamp,SenderAddress,TransactionHash,StatusCode,Nonce\n';
      allTransactions.forEach(tx => {
        csv += `"${tx.timestamp}","${tx.senderAddress}","${tx.transactionHash}","${tx.status}","${tx.nonce}"\n`;
      });
      
      return csv;
    }
  
    getTransactionCount() {
      const allTransactions = this.getAllTransactions();
      return allTransactions.length;
    }
  
    saveToFile() {
      const csv = this.generateCSV();
      if (!csv) {
        return { success: false, message: 'No transactions to save' };
      }
  
      try {
        const file = open(this.filename, 'w');
        file.write(csv);
        return { 
          success: true, 
          filename: this.filename,
          count: this.getTransactionCount()
        };
      } catch (error) {
        return { 
          success: false, 
          message: `Failed to save file: ${error}`,
          csvData: csv
        };
      }
    }
  
    printSummary() {
      const allTransactions = this.getAllTransactions();
      const count = allTransactions.length;
      const saveResult = this.saveToFile();
      
      console.log(`\n📊 TRANSACTION SUMMARY`);
      console.log(`Total transactions recorded: ${count}`);
      
      // Show breakdown by VU
      console.log(`Breakdown by VU:`);
      for (const [vuId, transactions] of this.vuData) {
        console.log(`  VU:${vuId} - ${transactions.length} transactions`);
      }
      
      if (saveResult.success) {
        console.log(`\n✅ CSV file saved: ${saveResult.filename}`);
        console.log(`📁 File location: Current directory`);
        console.log(`💾 To move to transaction_history folder, run:`);
        console.log(`   mv ${saveResult.filename} transaction_history/`);
        
        // Display preview
        const lines = saveResult.csvData.split('\n').slice(0, 6);
        console.log(`\n📋 CSV Preview (first 5 transactions):`);
        console.log('='.repeat(80));
        lines.forEach(line => console.log(line));
        if (count > 5) {
          console.log(`... and ${count - 5} more transactions`);
        }
        console.log('='.repeat(80));
      } else {
        console.log(`\n❌ Could not save CSV file: ${saveResult.message}`);
        if (saveResult.csvData) {
          console.log(`\n💾 CSV Data (copy manually):`);
          console.log('='.repeat(80));
          console.log(saveResult.csvData);
          console.log('='.repeat(80));
        }
      }
      
      return {
        filename: this.filename,
        count: count,
        saved: saveResult.success
      };
    }
  }
  
  // Create singleton instance - each VU gets its own instance
  export const csvLogger = new CSVLogger();