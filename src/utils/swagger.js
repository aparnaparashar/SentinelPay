const swaggerJSDoc = require('swagger-jsdoc');
const swaggerUi = require('swagger-ui-express');
const path = require('path');
const fs = require('fs');
const logger = require('./logger');

// Ensure docs directory exists
const docsDir = path.join(__dirname, '../../docs');
if (!fs.existsSync(docsDir)) {
  fs.mkdirSync(docsDir);
}

// Swagger definition options
const swaggerOptions = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'SentinelPay Banking API',
      version: '1.0.0',
      description: 'A secure and scalable banking API system with fraud detection capabilities',
      contact: {
        name: 'SentinelPay API Support',
        email: 'api@sentinelpay.com',
        url: 'https://sentinelpay.com/support'
      },
      license: {
        name: 'Apache 2.0',
        url: 'https://www.apache.org/licenses/LICENSE-2.0.html'
      }
    },
    servers: [
      {
        url: '/api',
        description: 'Development server'
      }
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT'
        },
        apiKeyAuth: {
          type: 'apiKey',
          in: 'header',
          name: 'X-API-KEY'
        }
      },
      schemas: {
        User: {
          type: 'object',
          required: ['email', 'password', 'firstName', 'lastName'],
          properties: {
            id: { type: 'string' },
            email: { type: 'string', format: 'email' },
            firstName: { type: 'string' },
            lastName: { type: 'string' },
            role: { 
              type: 'string', 
              enum: ['user', 'admin', 'manager'] 
            },
            isActive: { type: 'boolean', default: true },
            createdAt: { type: 'string', format: 'date-time' },
            updatedAt: { type: 'string', format: 'date-time' }
          }
        },
        Account: {
          type: 'object',
          required: ['userId', 'accountType', 'balance'],
          properties: {
            id: { type: 'string' },
            userId: { type: 'string' },
            accountNumber: { type: 'string' },
            accountType: { 
              type: 'string', 
              enum: ['checking', 'savings', 'investment', 'credit'] 
            },
            balance: { 
              type: 'number',
              format: 'float',
              description: 'Account balance in cents' 
            },
            currency: { 
              type: 'string', 
              default: 'USD',
              enum: ['USD', 'EUR', 'GBP', 'JPY', 'CAD']
            },
            isActive: { type: 'boolean', default: true },
            createdAt: { type: 'string', format: 'date-time' },
            updatedAt: { type: 'string', format: 'date-time' }
          }
        },
        Transaction: {
          type: 'object',
          required: ['sourceAccountId', 'amount', 'transactionType'],
          properties: {
            id: { type: 'string' },
            reference: { type: 'string' },
            sourceAccountId: { type: 'string' },
            destinationAccountId: { type: 'string' },
            amount: { 
              type: 'number',
              format: 'float',
              description: 'Transaction amount in cents'
            },
            currency: { 
              type: 'string',
              default: 'USD'
            },
            transactionType: { 
              type: 'string', 
              enum: ['deposit', 'withdrawal', 'transfer', 'payment', 'refund'] 
            },
            status: {
              type: 'string',
              enum: ['pending', 'completed', 'failed', 'reversed'],
              default: 'pending'
            },
            description: { type: 'string' },
            metadata: { type: 'object' },
            createdAt: { type: 'string', format: 'date-time' },
            updatedAt: { type: 'string', format: 'date-time' }
          }
        },
        Error: {
          type: 'object',
          properties: {
            status: { type: 'string' },
            message: { type: 'string' },
            stack: { type: 'string' }
          }
        }
      }
    },
    tags: [
      { name: 'Auth', description: 'Authentication and authorization endpoints' },
      { name: 'Users', description: 'User management endpoints' },
      { name: 'Accounts', description: 'Account management endpoints' },
      { name: 'Transactions', description: 'Transaction processing endpoints' },
      { name: 'Fraud', description: 'Fraud detection and prevention endpoints' },
      { name: 'Admin', description: 'Administrative endpoints' }
    ],
    security: [
      {
        bearerAuth: []
      }
    ]
  },
  apis: ['./src/routes/*.js', './src/models/*.js']
};

// Generate Swagger specification
const swaggerSpec = swaggerJSDoc(swaggerOptions);

// Export Swagger setup function
const setupSwagger = (app) => {
  // Serve Swagger docs JSON endpoint
  app.get('/api/docs.json', (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.send(swaggerSpec);
  });

  // Serve Swagger UI
  app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec, {
    explorer: true,
    customCss: '.swagger-ui .topbar { display: none }'
  }));

  // Save Swagger YAML to file
  try {
    fs.writeFileSync(
      path.join(docsDir, 'api-docs.json'),
      JSON.stringify(swaggerSpec, null, 2)
    );
    logger.info('Swagger documentation generated successfully');
  } catch (err) {
    logger.error('Failed to write Swagger documentation:', err);
  }
};

module.exports = { setupSwagger };