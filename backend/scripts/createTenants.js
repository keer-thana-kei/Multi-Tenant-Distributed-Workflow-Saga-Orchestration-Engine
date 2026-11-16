
require('dotenv').config();

const mongoose = require('mongoose');
const Tenant = require('../src/models/Tenant');
const { generateApiKey } = require('../src/middleware/Tenant');

async function createTenant() {
    try {
        // Check MongoDB connection string
        if (!process.env.MONGODB_URI) {
            throw new Error('MONGODB_URI is missing in .env file');
        }

        // Connect to MongoDB
        await mongoose.connect(process.env.MONGODB_URI);

        console.log('MongoDB connected successfully!');

        // Get tenant name from command line
        const tenantName = process.argv[2] || 'Test Co';

        // Prevent duplicate tenant names
        const existingTenant = await Tenant.findOne({
            name: tenantName
        });

        if (existingTenant) {
            console.log('Tenant already exists!');
            console.log('Tenant ID:', existingTenant._id.toString());

            return;
        }

        // Generate API key
        const { key, hash, prefix } = generateApiKey();

        // Create tenant
        const tenant = await Tenant.create({
            name: tenantName,
            apiKeyHash: hash,
            apiKeyPrefix: prefix,
            active: true
        });

        // Display tenant details
        console.log('\nTenant created successfully!');
        console.log('Tenant Name:', tenant.name);
        console.log('Tenant ID:', tenant._id.toString());
        console.log('API KEY (save securely):', key);

        console.log('\nSave this API key now. It cannot be retrieved later.');
    } catch (error) {
        console.error('Tenant creation failed:', error.message);
        process.exitCode = 1;
    } finally {
        // Close MongoDB connection
        await mongoose.disconnect();
    }
}

createTenant();
