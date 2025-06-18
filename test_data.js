import { open } from 'k6';

export default function() {
    const senderPath = './wallets/output_part_1.json';
    const receiverPath = './wallets/output_part_2.json';
    
    try {
        const senderData = JSON.parse(open(senderPath));
        console.log('First sender:', JSON.stringify(senderData[0]));
        console.log('Last sender:', JSON.stringify(senderData[senderData.length-1]));
        
        const receiverData = JSON.parse(open(receiverPath));
        console.log('First receiver:', JSON.stringify(receiverData[0]));
        console.log('Last receiver:', JSON.stringify(receiverData[receiverData.length-1]));
    } catch (e) {
        console.error('Error:', e.message);
    }
}
