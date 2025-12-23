'use strict'

/**
 * Test script to generate a sample invoice PDF
 * Run with: node test/generate-test-invoice.js
 */

const ejs = require('ejs')
const puppeteer = require('puppeteer')
const path = require('path')
const fs = require('fs')

// Sample data matching the reference invoice (vat_invoice_INV-EE-113.pdf)
const sampleInvoiceData = {
  invoiceNumber: 'INV-EE-113',
  invoiceTotal: '€46.24',
  dateOfIssue: 'November 20, 2025',
  dateOfSupply: 'November 20, 2025',

  merchant: {
    companyName: 'Eurosec OÜ',
    address1: 'Treiali tee',
    address2: '2-7',
    zip: '75312',
    city: 'Rae parish',
    country: 'Estonia',
    email: 'info@eurosec.ee',
    phone: '+372 687 1196',
    vatId: 'EE101295293'
  },

  billTo: {
    name: 'Toomas Villo',
    line1: 'Kodu tee 15',
    line2: '',
    zip: '75312',
    city: 'Rae',
    country: 'Estonia'
  },

  shipTo: {
    name: 'Toomas Villo',
    line1: 'Kodu tee 15',
    line2: '',
    zip: '75312',
    city: 'Rae',
    country: 'Estonia'
  },

  lineItems: [
    {
      description: 'Sordin SmartEar Impulse Orange (M/L) (27170-07-S)',
      quantity: 2,
      unitPrice: '€17.03',
      unitPriceRaw: 17.03,
      vatRate: 0.24,
      vatRateFormatted: '24%',
      amount: '€34.06',
      amountRaw: 34.06
    }
  ],

  pricing: {
    subtotal: '€34.06',
    subtotalRaw: 34.06,
    vatRate: 0.24,
    vatRateFormatted: '24%',
    vatAmount: '€8.18',
    shipping: '€3.23',
    shippingRaw: 3.23,
    shippingVatRate: 0.24,
    shippingVatRateFormatted: '24%',
    shippingVat: '€0.77',
    total: '€46.24',
    totalRaw: 46.24,
    currencyCode: 'EUR',
    currencySymbol: '€'
  },

  pageInfo: {
    current: 1,
    total: 1
  }
}

async function generateTestInvoice() {
  console.log('Generating test invoice PDF...')

  try {
    // Read and render template
    const templatePath = path.join(__dirname, '../views/invoice-template.ejs')
    const html = await ejs.renderFile(templatePath, sampleInvoiceData)

    // Launch browser
    const browser = await puppeteer.launch({
      headless: 'new',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu'
      ]
    })

    const page = await browser.newPage()

    // Set content
    await page.setContent(html, {
      waitUntil: 'networkidle0'
    })

    // Generate PDF
    const pdf = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: {
        top: '15mm',
        right: '15mm',
        bottom: '15mm',
        left: '15mm'
      }
    })

    // Save PDF
    const outputPath = path.join(__dirname, '../test_invoice_output.pdf')
    fs.writeFileSync(outputPath, pdf)

    await browser.close()

    console.log(`✅ Test invoice PDF generated successfully!`)
    console.log(`📄 Output: ${outputPath}`)
    console.log('')
    console.log('Invoice details:')
    console.log(`  - Invoice #: ${sampleInvoiceData.invoiceNumber}`)
    console.log(`  - Total: ${sampleInvoiceData.invoiceTotal}`)
    console.log(`  - Customer: ${sampleInvoiceData.billTo.name}`)
    console.log(`  - Line items: ${sampleInvoiceData.lineItems.length}`)

  } catch (error) {
    console.error('❌ Failed to generate test invoice:', error.message)
    console.error(error)
    process.exit(1)
  }
}

// Run the test
generateTestInvoice()

