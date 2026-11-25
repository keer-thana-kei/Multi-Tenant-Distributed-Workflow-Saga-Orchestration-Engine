require('dotenv').config();
const mongoose = require('mongoose');
const Tenant = require('./src/models/Tenant');

async function checkTenants() {
    try {
        await mongoose.connect(process.env.MONGODB_URI);

        const tenants = await Tenant.find({}, 'name active');

        console.log('Tenants in database:');
        console.log(tenants);

    } catch (error) {
        console.error(error.message);
    } finally {
        await mongoose.disconnect();
    }
}

checkTenants();