// test_data_enhanced.js
import { open } from 'k6';

function validateJSON(path, type) {
    try {
        const rawData = open(path);
        if (!rawData) {
            throw new Error('File is empty or cannot be read');
        }

        const data = JSON.parse(rawData);
        if (!Array.isArray(data)) {
            throw new Error('Data must be an array');
        }

        console.log(`Found ${data.length} ${type}`);
        
        // Check for null values
        let nullCount = 0;
        data.forEach((item, index) => {
            if (item === null || item === undefined) {
                console.log(`Found null at ${type} index ${index}`);
                nullCount++;
            } else if (type === 'senders' && (!item.address || !item.privateKey)) {
                console.log(`Invalid sender at index ${index}: ${JSON.stringify(item)}`);
                nullCount++;
            } else if (type === 'receivers' && typeof item !== 'string' && (!item || !item.address)) {
                console.log(`Invalid receiver at index ${index}: ${JSON.stringify(item)}`);
                nullCount++;
            }
        });

        if (nullCount > 0) {
            throw new Error(`Found ${nullCount} invalid entries in ${path}`);
        }

        console.log(`First 3 ${type}:`);
        console.log(JSON.stringify(data.slice(0, 3), null, 2));
        console.log(`Last 3 ${type}:`);
        console.log(JSON.stringify(data.slice(-3), null, 2));

        return true;
    } catch (e) {
        console.error(`Error validating ${path}:`, e.message);
        return false;
    }
}

export default function() {
    const senderPath = './wallets/output_part_1.json';
    const receiverPath = './wallets/output_part_2.json';

    console.log(`\n=== Validating ${senderPath} ===`);
    const senderValid = validateJSON(senderPath, 'senders');

    console.log(`\n=== Validating ${receiverPath} ===`);
    const receiverValid = validateJSON(receiverPath, 'receivers');

    if (!senderValid || !receiverValid) {
        throw new Error('Data validation failed');
    }

    console.log('\nBoth files validated successfully');
}