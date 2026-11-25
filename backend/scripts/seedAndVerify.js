const crypto = require('crypto');
const mongoose = require('mongoose');
require('dotenv').config({ path: __dirname + '/../.env' });

const Tenant = require('../src/models/Tenant');
const Workflow = require('../src/models/Workflow');
const Execution = require('../src/models/Execution');

const hashKey = (key) => crypto.createHash('sha256').update(key).digest('hex');

const PRIMARY_KEY = 'wf_3c5cf0ccd3088b2f4ab4b19bd57c153971d7eb63b6b92245';
const SECONDARY_KEY = 'wf_tenant_b_isolated_key_999888777666555444333222';

async function seed() {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('Connected to MongoDB Atlas');

    // 1. Setup Tenant A (Primary Tenant)
    const primaryHash = hashKey(PRIMARY_KEY);
    let tenantA = await Tenant.findOne({ apiKeyHash: primaryHash });
    if (!tenantA) {
        tenantA = await Tenant.create({
            name: 'Acme Corporation (Tenant A)',
            apiKeyHash: primaryHash,
            apiKeyPrefix: PRIMARY_KEY.slice(0, 7),
            active: true,
            maxRunsPerMinute: 60
        });
        console.log('Created Tenant A:', tenantA._id.toString());
    } else {
        console.log('Tenant A exists:', tenantA._id.toString());
    }

    // 2. Setup Tenant B (For Isolation Testing)
    const secondaryHash = hashKey(SECONDARY_KEY);
    let tenantB = await Tenant.findOne({ apiKeyHash: secondaryHash });
    if (!tenantB) {
        tenantB = await Tenant.create({
            name: 'Beta Global (Tenant B)',
            apiKeyHash: secondaryHash,
            apiKeyPrefix: SECONDARY_KEY.slice(0, 7),
            active: true,
            maxRunsPerMinute: 30
        });
        console.log('Created Tenant B:', tenantB._id.toString());
    } else {
        console.log('Tenant B exists:', tenantB._id.toString());
    }

    // 3. Clear existing test workflows & executions for clean reproducible testing
    await Workflow.deleteMany({ companyId: { $in: [tenantA._id, tenantB._id] } });
    await Execution.deleteMany({ companyId: { $in: [tenantA._id, tenantB._id] } });

    // 4. Create Workflows for Tenant A
    const wfA1 = await Workflow.create({
        companyId: tenantA._id,
        workflowName: 'Order Processing Saga',
        triggerEvent: 'order.created',
        steps: [
            { name: 'ReserveInventory', url: 'http://inventory.internal/reserve', maxRetries: 3 },
            { name: 'ProcessPayment', url: 'http://payments.internal/charge', maxRetries: 3 },
            { name: 'DispatchOrder', url: 'http://shipping.internal/ship', maxRetries: 3 }
        ]
    });

    const wfA2 = await Workflow.create({
        companyId: tenantA._id,
        workflowName: 'Customer Onboarding Saga',
        triggerEvent: 'user.signup',
        steps: [
            { name: 'VerifyIdentity', url: 'http://kyc.internal/verify', maxRetries: 2 },
            { name: 'CreateAccount', url: 'http://accounts.internal/create', maxRetries: 3 },
            { name: 'SendWelcomeEmail', url: 'http://notifications.internal/email', maxRetries: 3 }
        ]
    });

    // 5. Create Workflow for Tenant B
    const wfB1 = await Workflow.create({
        companyId: tenantB._id,
        workflowName: 'Secret Tenant B Workflow',
        triggerEvent: 'b.event',
        steps: [
            { name: 'TenantBStep1', url: 'http://secret.internal/1', maxRetries: 2 },
            { name: 'TenantBStep2', url: 'http://secret.internal/2', maxRetries: 2 }
        ]
    });

    // 6. Generate Executions for Tenant A
    const now = Date.now();
    const dayMs = 24 * 60 * 60 * 1000;
    const executionsA = [];

    // Helper to generate step array
    const makeSteps = (stepDefs, stepFail = null, retryStep = null) => {
        return stepDefs.map(s => {
            const isFailed = stepFail && s.name === stepFail;
            const hasRetries = retryStep && s.name === retryStep;
            return {
                name: s.name,
                url: s.url,
                method: 'POST',
                maxRetries: s.maxRetries,
                status: isFailed ? 'failed' : 'success',
                attempts: hasRetries ? 3 : (isFailed ? 2 : 1),
                startedAt: new Date(now - 10000),
                finishedAt: new Date(now - 2000)
            };
        });
    };

    // A. Successful Executions across different days
    for (let i = 0; i < 18; i++) {
        const offset = (i % 7) * dayMs + (i * 3600 * 1000);
        const start = new Date(now - offset - (1000 + i * 250));
        const finish = new Date(start.getTime() + 800 + (i * 300)); // durations between 800ms and ~6s
        executionsA.push({
            companyId: tenantA._id,
            workflowId: i % 2 === 0 ? wfA1._id : wfA2._id,
            status: 'success',
            steps: makeSteps(i % 2 === 0 ? wfA1.steps : wfA2.steps, null, i % 3 === 0 ? 'ProcessPayment' : null),
            startedAt: start,
            finishedAt: finish,
            createdAt: start,
            updatedAt: finish
        });
    }

    // B. Failed Executions across different days and hours
    for (let i = 0; i < 7; i++) {
        const offset = (i % 5) * dayMs + (i * 7200 * 1000);
        const start = new Date(now - offset - 3000);
        const finish = new Date(start.getTime() + 1500 + (i * 500));
        executionsA.push({
            companyId: tenantA._id,
            workflowId: wfA1._id,
            status: 'failed',
            steps: makeSteps(wfA1.steps, 'ProcessPayment', 'ProcessPayment'),
            startedAt: start,
            finishedAt: finish,
            createdAt: start,
            updatedAt: finish
        });
    }

    // C. Compensated Executions
    for (let i = 0; i < 3; i++) {
        const offset = (i % 3) * dayMs;
        const start = new Date(now - offset - 5000);
        const finish = new Date(start.getTime() + 4500);
        executionsA.push({
            companyId: tenantA._id,
            workflowId: wfA2._id,
            status: 'compensated',
            steps: makeSteps(wfA2.steps, 'CreateAccount', 'VerifyIdentity'),
            startedAt: start,
            finishedAt: finish,
            createdAt: start,
            updatedAt: finish
        });
    }

    // D. Running Executions (unfinished, no finishedAt)
    for (let i = 0; i < 2; i++) {
        const start = new Date(now - 15000);
        executionsA.push({
            companyId: tenantA._id,
            workflowId: wfA1._id,
            status: 'running',
            steps: makeSteps(wfA1.steps),
            startedAt: start,
            createdAt: start,
            updatedAt: start
        });
    }

    // Insert Tenant A executions
    await Execution.insertMany(executionsA);
    console.log(`Seeded ${executionsA.length} executions for Tenant A`);

    // 7. Generate Executions for Tenant B (to verify isolation)
    const executionsB = [];
    for (let i = 0; i < 10; i++) {
        const start = new Date(now - i * dayMs);
        const finish = new Date(start.getTime() + 2000);
        executionsB.push({
            companyId: tenantB._id,
            workflowId: wfB1._id,
            status: i % 2 === 0 ? 'success' : 'failed',
            steps: makeSteps(wfB1.steps),
            startedAt: start,
            finishedAt: finish,
            createdAt: start,
            updatedAt: finish
        });
    }
    await Execution.insertMany(executionsB);
    console.log(`Seeded ${executionsB.length} executions for Tenant B`);

    await mongoose.disconnect();
    console.log('Seeding completed successfully!');
}

seed().catch(err => {
    console.error('Seed error:', err);
    process.exit(1);
});
