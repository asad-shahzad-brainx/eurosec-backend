'use strict'

/**
 * Invoice PDF Service
 * Orchestrates PDF generation, upload, and attachment to draft orders
 */
class InvoicePdfService {
  constructor(fastify) {
    this.fastify = fastify
  }

  /**
   * Generate invoice PDF and attach to draft order
   * Handles the complete workflow: generate PDF -> upload to Shopify -> attach to draft order
   * 
   * @param {Object} draftOrder - Draft order data
   * @param {Object} payload - Optional original payload data (for cart-based flow)
   * @returns {Promise<Object>} Result with status and URL
   */
  async generateAndAttachPdf(draftOrder, payload = null) {
    try {
      // Step 1: Generate VAT Invoice PDF
      const invoiceData = { draftOrder, payload }
      const pdfFile = await this.fastify.services.pdf.generateInvoicePdf(invoiceData)
      const pdfBuffer = Buffer.from(pdfFile)
      
      // Generate filename with invoice number
      const invoiceNumber = draftOrder.name 
        ? `INV-EE-${draftOrder.name.replace(/[^0-9]/g, '')}`
        : `INV-EE-${Date.now()}`
      const filename = `vat_invoice_${invoiceNumber}.pdf`
      
      // Step 2: Upload PDF to Shopify (waits for URL to be ready)
      const file = await this.fastify.services.shopifyFile.uploadPdf(pdfBuffer, filename, {
        alt: `VAT Invoice ${invoiceNumber}`
      })

      // Step 3: Attach PDF URL to draft order via metafield
      await this.fastify.services.shopifyFile.attachFileToDraftOrder(
        draftOrder.id,
        file.url
      )

      this.fastify.log.info({
        draftOrderId: draftOrder.id,
        invoiceNumber,
        pdfUrl: file.url
      }, 'VAT Invoice PDF created and attached successfully')

      return {
        status: 'completed',
        url: file.url
      }

    } catch (error) {
      // PDF generation or upload failed
      this.fastify.log.error({ 
        error, 
        draftOrderId: draftOrder.id 
      }, 'PDF generation/upload failed')
      
      return {
        status: 'pdf_failed',
        url: null
      }
    }
  }
}

module.exports = InvoicePdfService

