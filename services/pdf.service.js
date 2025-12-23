'use strict'

const ejs = require('ejs')
const puppeteer = require('puppeteer')
const path = require('path')
const getSymbolFromCurrency = require('currency-symbol-map')

/**
 * PDF Service
 * Handles PDF generation using EJS templates and Puppeteer
 */
class PdfService {
  constructor(fastify) {
    this.fastify = fastify
    this.browser = null
  }

  /**
   * Get or create browser instance (reuse for performance)
   * @returns {Promise<Browser>}
   */
  async getBrowser() {
    if (!this.browser || !this.browser.isConnected()) {
      this.fastify.log.info('Launching Puppeteer browser')
      this.browser = await puppeteer.launch({
        headless: 'new',
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-gpu'
        ]
      })
    }
    return this.browser
  }

  /**
   * Generate PDF from quote data (legacy method for quotes)
   * @param {Object} quoteData - Quote data including line items, customer, etc.
   * @returns {Promise<Buffer>} PDF buffer
   */
  async generateQuotePdf(quoteData) {
    this.fastify.log.info('Generating quote PDF')

    try {
      // Prepare template data
      const templateData = this.prepareQuoteTemplateData(quoteData)

      // Render HTML from EJS template
      const templatePath = path.join(__dirname, '../views/quote-template.ejs')
      const html = await ejs.renderFile(templatePath, templateData)

      // Generate PDF with Puppeteer
      const pdf = await this.renderHtmlToPdf(html)

      this.fastify.log.info('Quote PDF generated successfully')
      return pdf
    } catch (error) {
      this.fastify.log.error({ error }, 'Failed to generate quote PDF')
      throw new Error(`Quote PDF generation failed: ${error.message}`)
    }
  }

  /**
   * Generate VAT invoice PDF from draft order data
   * @param {Object} invoiceData - Invoice data including draft order, line items, etc.
   * @returns {Promise<Buffer>} PDF buffer
   */
  async generateInvoicePdf(invoiceData) {
    this.fastify.log.info('Generating invoice PDF')

    try {
      // Prepare template data for invoice
      const templateData = this.prepareInvoiceTemplateData(invoiceData)

      // Render HTML from EJS template
      const templatePath = path.join(__dirname, '../views/invoice-template.ejs')
      const html = await ejs.renderFile(templatePath, templateData)

      // Generate PDF with Puppeteer
      const pdf = await this.renderHtmlToPdf(html)

      this.fastify.log.info('Invoice PDF generated successfully')
      return pdf
    } catch (error) {
      this.fastify.log.error({ error }, 'Failed to generate invoice PDF')
      throw new Error(`Invoice PDF generation failed: ${error.message}`)
    }
  }

  /**
   * Render HTML content to PDF
   * @param {string} html - HTML content
   * @returns {Promise<Buffer>} PDF buffer
   */
  async renderHtmlToPdf(html) {
    const browser = await this.getBrowser()
    const page = await browser.newPage()

    // Set content and wait for any resources to load
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

    await page.close()
    return pdf
  }

  /**
   * Prepare data for invoice template rendering
   * @param {Object} invoiceData - Raw invoice data (includes draftOrder + original payload)
   * @returns {Object} Formatted template data
   */
  prepareInvoiceTemplateData(invoiceData) {
    const { draftOrder, payload } = invoiceData
    const config = this.fastify.config
    const merchant = config?.merchant || {}
    const invoiceConfig = config?.invoice || {}

    // Generate invoice number from draft order name
    const invoiceNumber = this.generateInvoiceNumber(draftOrder?.name, invoiceConfig.prefix)
    
    // Parse dates
    const issueDate = draftOrder?.createdAt ? new Date(draftOrder.createdAt) : new Date()
    const formattedDate = this.formatDate(issueDate)

    // Get currency info from draft order (always present from Shopify)
    const currencyCode = draftOrder?.currencyCode || 'EUR'
    const currencySymbol = this.getCurrencySymbol(currencyCode)

    // Parse amounts
    const subtotal = this.parseAmount(draftOrder?.subtotalPrice)
    const totalTax = this.parseAmount(draftOrder?.totalTax)
    const total = this.parseAmount(draftOrder?.totalPrice)

    // Get discount info
    const discountInfo = this.processDiscountInfo(draftOrder, currencySymbol)

    // Get shipping info
    const shippingLine = draftOrder?.shippingLine
    const shippingPrice = this.parseAmount(shippingLine?.price)
    const shippingTax = this.calculateShippingTax(shippingLine)
    const shippingTaxRate = this.getShippingTaxRate(shippingLine)

    // Process line items with tax info
    const lineItems = this.processInvoiceLineItems(draftOrder?.lineItems, currencySymbol)

    // Get primary VAT rate from line items or tax lines
    const primaryVatRate = this.getPrimaryVatRate(lineItems, draftOrder?.taxLines)

    // Build bill to and ship to addresses
    const billToAddress = this.formatInvoiceAddress(
      draftOrder?.billingAddress || draftOrder?.shippingAddress,
      draftOrder?.customer,
      draftOrder?.company
    )
    const shipToAddress = this.formatInvoiceAddress(
      draftOrder?.shippingAddress,
      draftOrder?.customer,
      draftOrder?.company
    )

    return {
      // Invoice header
      invoiceNumber,
      invoiceTotal: this.formatPrice(total, currencySymbol),
      dateOfIssue: formattedDate,
      dateOfSupply: formattedDate, // Same as date of issue per requirement

      // Merchant info (all fields from store data or environment variables)
      merchant: {
        companyName: merchant.companyName || '',
        address1: merchant.address1 || '',
        address2: merchant.address2 || '',
        zip: merchant.zip || '',
        city: merchant.city || '',
        country: merchant.country || '',
        email: merchant.email || '',
        phone: merchant.phone || '',
        vatId: merchant.vatId || ''
      },

      // Customer addresses
      billTo: billToAddress,
      shipTo: shipToAddress,

      // Line items
      lineItems,

      // Discount info
      discount: discountInfo,

      // Pricing breakdown
      pricing: {
        subtotal: this.formatPrice(subtotal, currencySymbol),
        subtotalRaw: subtotal,
        vatRate: primaryVatRate,
        vatRateFormatted: `${Math.round(primaryVatRate * 100)}%`,
        vatAmount: this.formatPrice(totalTax - shippingTax, currencySymbol),
        shipping: this.formatPrice(shippingPrice, currencySymbol),
        shippingRaw: shippingPrice,
        shippingVatRate: shippingTaxRate,
        shippingVatRateFormatted: `${Math.round(shippingTaxRate * 100)}%`,
        shippingVat: this.formatPrice(shippingTax, currencySymbol),
        total: this.formatPrice(total, currencySymbol),
        totalRaw: total,
        currencyCode,
        currencySymbol
      },

      // Metadata
      pageInfo: {
        current: 1,
        total: 1
      }
    }
  }

  /**
   * Process discount information from draft order
   * @param {Object} draftOrder - Draft order object
   * @param {string} currencySymbol - Currency symbol
   * @returns {Object|null} Discount information or null if no discount
   */
  processDiscountInfo(draftOrder, currencySymbol) {
    // Check if there's a discount applied
    const hasDiscount = draftOrder?.totalDiscountsSet?.shopMoney?.amount && 
                        parseFloat(draftOrder.totalDiscountsSet.shopMoney.amount) > 0

    if (!hasDiscount) {
      return null
    }

    const discountAmount = this.parseAmount(draftOrder.totalDiscountsSet.shopMoney.amount)
    
    // Build discount description
    let description = 'Discount'
    
    // Use appliedDiscount info if available
    if (draftOrder.appliedDiscount) {
      if (draftOrder.appliedDiscount.title) {
        description = draftOrder.appliedDiscount.title
      } else if (draftOrder.appliedDiscount.description) {
        description = draftOrder.appliedDiscount.description
      }
      
      // Add discount value type info
      if (draftOrder.appliedDiscount.valueType === 'PERCENTAGE') {
        description += ` (${draftOrder.appliedDiscount.value}%)`
      }
    }
    
    // Or use discount codes if available
    if (!draftOrder.appliedDiscount && draftOrder.discountCodes?.length > 0) {
      description = `Discount Code: ${draftOrder.discountCodes.join(', ')}`
    }

    return {
      amount: discountAmount,
      amountFormatted: this.formatPrice(discountAmount, currencySymbol),
      description,
      codes: draftOrder.discountCodes || []
    }
  }

  /**
   * Process line items for invoice display
   * @param {Object} lineItems - Line items from draft order
   * @param {string} currencySymbol - Currency symbol
   * @returns {Array} Processed line items
   */
  processInvoiceLineItems(lineItems, currencySymbol) {
    if (!lineItems?.edges) return []

    return lineItems.edges.map(({ node }) => {
      const quantity = node.quantity || 1
      const unitPrice = this.parseAmount(node.originalUnitPrice)
      const lineTotal = unitPrice * quantity
      
      // Get VAT rate from tax lines
      const vatRate = this.getLineItemVatRate(node.taxLines)
      
      // Build description: Product title + variant + SKU
      const variantTitle = node.variant?.title
      const sku = node.variant?.sku
      let description = node.title || 'Product'
      
      // Add variant title if different from "Default Title"
      if (variantTitle && variantTitle !== 'Default Title' && variantTitle !== node.title) {
        description += ` (${variantTitle})`
      }
      
      // Add SKU if present
      if (sku) {
        description += ` (${sku})`
      }

      return {
        description,
        title: node.title,
        variantTitle: variantTitle || '',
        sku: sku || '',
        quantity,
        unitPrice: this.formatPrice(unitPrice, currencySymbol),
        unitPriceRaw: unitPrice,
        vatRate,
        vatRateFormatted: `${Math.round(vatRate * 100)}%`,
        amount: this.formatPrice(lineTotal, currencySymbol),
        amountRaw: lineTotal
      }
    })
  }

  /**
   * Get VAT rate from line item tax lines
   * @param {Array} taxLines - Tax lines array
   * @returns {number} VAT rate as decimal (e.g., 0.24 for 24%)
   */
  getLineItemVatRate(taxLines) {
    if (!taxLines || taxLines.length === 0) return 0
    // Return the first tax line rate (usually there's only one)
    return taxLines[0].rate || 0
  }

  /**
   * Get primary VAT rate from line items or order tax lines
   * @param {Array} lineItems - Processed line items
   * @param {Array} orderTaxLines - Order-level tax lines
   * @returns {number} Primary VAT rate as decimal
   */
  getPrimaryVatRate(lineItems, orderTaxLines) {
    // First try to get from line items
    if (lineItems && lineItems.length > 0) {
      const firstWithRate = lineItems.find(item => item.vatRate > 0)
      if (firstWithRate) return firstWithRate.vatRate
    }
    
    // Fallback to order tax lines
    if (orderTaxLines && orderTaxLines.length > 0) {
      return orderTaxLines[0].rate || 0
    }
    
    return 0.24 // Default to 24% for Estonia
  }

  /**
   * Calculate shipping tax amount
   * @param {Object} shippingLine - Shipping line from draft order
   * @returns {number} Shipping tax amount
   */
  calculateShippingTax(shippingLine) {
    if (!shippingLine?.taxLines || shippingLine.taxLines.length === 0) return 0
    return shippingLine.taxLines.reduce((sum, tax) => sum + this.parseAmount(tax.price), 0)
  }

  /**
   * Get shipping tax rate
   * @param {Object} shippingLine - Shipping line from draft order
   * @returns {number} Shipping tax rate as decimal
   */
  getShippingTaxRate(shippingLine) {
    if (!shippingLine?.taxLines || shippingLine.taxLines.length === 0) return 0.24 // Default
    return shippingLine.taxLines[0].rate || 0.24
  }

  /**
   * Format address for invoice display
   * @param {Object} address - Address object
   * @param {Object} customer - Customer object
   * @param {Object} company - B2B Company object (optional)
   * @returns {Object} Formatted address
   */
  formatInvoiceAddress(address, customer, company = null) {
    if (!address) {
      return {
        companyName: company?.name || '',
        name: customer?.firstName && customer?.lastName 
          ? `${customer.firstName} ${customer.lastName}`.trim()
          : 'Customer',
        line1: '',
        line2: '',
        city: '',
        zip: '',
        country: ''
      }
    }

    const name = address.firstName && address.lastName
      ? `${address.firstName} ${address.lastName}`.trim()
      : customer?.firstName && customer?.lastName
        ? `${customer.firstName} ${customer.lastName}`.trim()
        : 'Customer'

    return {
      companyName: company?.name || address.company || '',
      name,
      line1: address.address1 || '',
      line2: address.address2 || '',
      city: address.city || '',
      zip: address.zip || '',
      province: address.province || '',
      country: address.country || ''
    }
  }

  /**
   * Generate invoice number from draft order name
   * @param {string} draftOrderName - Draft order name (e.g., "#D123")
   * @param {string} prefix - Invoice prefix
   * @returns {string} Invoice number
   */
  generateInvoiceNumber(draftOrderName, prefix = 'INV-EE-') {
    if (draftOrderName) {
      // Extract number from draft order name (e.g., "#D123" -> "123")
      const match = draftOrderName.match(/\d+/)
      if (match) {
        return `${prefix}${match[0]}`
      }
    }
    
    // Fallback to timestamp-based number
    const timestamp = Date.now().toString().slice(-6)
    return `${prefix}${timestamp}`
  }

  /**
   * Format date for display
   * @param {Date} date - Date object
   * @returns {string} Formatted date string
   */
  formatDate(date) {
    return date.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    })
  }

  /**
   * Parse amount from string or number
   * @param {string|number} amount - Amount value
   * @returns {number} Parsed amount
   */
  parseAmount(amount) {
    if (amount === undefined || amount === null) return 0
    if (typeof amount === 'number') return amount
    return parseFloat(amount) || 0
  }

  /**
   * Format price with currency symbol
   * @param {number} price - Price value
   * @param {string} currencySymbol - Currency symbol
   * @returns {string} Formatted price string
   */
  formatPrice(price, currencySymbol = '€') {
    if (price === undefined || price === null) return `${currencySymbol}0.00`
    return `${currencySymbol}${Number(price).toFixed(2)}`
  }

  /**
   * Get currency symbol from currency code using currency-symbol-map package
   * Supports 170+ currencies with proper symbols
   * @param {string} currencyCode - ISO currency code
   * @param {string} defaultSymbol - Default symbol if not found
   * @returns {string} Currency symbol
   */
  getCurrencySymbol(currencyCode, defaultSymbol = '€') {
    if (!currencyCode) return defaultSymbol
    return getSymbolFromCurrency(currencyCode) || defaultSymbol
  }

  // ==================== Legacy Quote Methods ====================

  /**
   * Prepare data for quote template rendering (legacy)
   * @param {Object} quoteData - Raw quote data
   * @returns {Object} Formatted template data
   */
  prepareQuoteTemplateData(quoteData) {
    const now = new Date()

    return {
      // Quote metadata
      quoteNumber: this.generateQuoteNumber(),
      quoteDate: now.toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric'
      }),
      generatedAt: now.toISOString(),

      // Shop information
      shop: {
        name: quoteData.shop?.name || 'Store Name',
        domain: quoteData.shop?.domain || '',
        ...quoteData.shop
      },

      // Customer information
      customer: {
        email: quoteData.customer?.email || '',
        firstName: quoteData.customer?.firstName || '',
        lastName: quoteData.customer?.lastName || '',
        fullName: this.getFullName(quoteData.customer),
        phone: quoteData.customer?.phone || '',
        ...quoteData.customer
      },

      // Line items
      lineItems: (quoteData.cartLines || []).map((item, index) => ({
        index: index + 1,
        title: item.title || 'Product',
        variantTitle: item.variantTitle || '',
        sku: item.sku || 'N/A',
        quantity: item.quantity || 1,
        price: this.formatPriceLegacy(item.price),
        lineTotal: this.formatPriceLegacy((item.price || 0) * (item.quantity || 1)),
        image: item.image || '',
        properties: item.properties || []
      })),

      // Pricing
      pricing: {
        subtotal: this.formatPriceLegacy(quoteData.pricing?.subtotal),
        total: this.formatPriceLegacy(quoteData.pricing?.total || quoteData.pricing?.subtotal),
        currency: quoteData.pricing?.currency || 'USD',
        discountCodes: quoteData.pricing?.discountCodes || []
      },

      // Addresses
      shippingAddress: this.formatAddress(quoteData.shippingAddress),
      billingAddress: this.formatAddress(quoteData.billingAddress),

      // Additional info
      note: quoteData.note || '',
      locale: quoteData.locale || 'en-US'
    }
  }

  /**
   * Generate a unique quote number
   * @returns {string}
   */
  generateQuoteNumber() {
    const timestamp = Date.now().toString(36).toUpperCase()
    const random = Math.random().toString(36).substring(2, 6).toUpperCase()
    return `Q-${timestamp}-${random}`
  }

  /**
   * Get full name from customer object
   * @param {Object} customer
   * @returns {string}
   */
  getFullName(customer) {
    if (!customer) return ''
    const firstName = customer.firstName || ''
    const lastName = customer.lastName || ''
    return `${firstName} ${lastName}`.trim() || 'Customer'
  }

  /**
   * Format price (legacy - without currency symbol)
   * @param {number} price
   * @returns {string}
   */
  formatPriceLegacy(price) {
    if (price === undefined || price === null) return '0.00'
    return Number(price).toFixed(2)
  }

  /**
   * Format address for display (legacy quote)
   * @param {Object} address
   * @returns {Object}
   */
  formatAddress(address) {
    if (!address) return null

    return {
      fullName: `${address.firstName || ''} ${address.lastName || ''}`.trim(),
      company: address.company || '',
      address1: address.address1 || '',
      address2: address.address2 || '',
      city: address.city || '',
      province: address.province || '',
      country: address.country || '',
      zip: address.zip || '',
      phone: address.phone || '',
      formatted: this.getFormattedAddress(address)
    }
  }

  /**
   * Get formatted address string
   * @param {Object} address
   * @returns {string}
   */
  getFormattedAddress(address) {
    if (!address) return ''

    const parts = []
    
    if (address.address1) parts.push(address.address1)
    if (address.address2) parts.push(address.address2)
    
    const cityLine = [
      address.city,
      address.province,
      address.zip
    ].filter(Boolean).join(', ')
    
    if (cityLine) parts.push(cityLine)
    if (address.country) parts.push(address.country)

    return parts.join('\n')
  }

  /**
   * Close browser instance (cleanup)
   */
  async closeBrowser() {
    if (this.browser && this.browser.isConnected()) {
      this.fastify.log.info('Closing Puppeteer browser')
      await this.browser.close()
      this.browser = null
    }
  }
}

module.exports = PdfService
