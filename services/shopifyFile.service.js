'use strict'

const FormData = require('form-data')
const { Readable } = require('stream')
const axios = require('axios');

/**
 * Shopify File Service
 * Handles file uploads to Shopify's CDN via the Files API
 */
class ShopifyFileService {
  constructor(fastify) {
    this.fastify = fastify
    this.adminClient = fastify.shopify.admin
  }

  /**
   * Upload PDF file to Shopify
   * @param {Buffer} pdfBuffer - PDF file buffer
   * @param {string} filename - Filename for the PDF
   * @param {Object} metadata - Additional metadata
   * @returns {Promise<Object>} File details with URL
   */
  async uploadPdf(pdfBuffer, filename, metadata = {}) {
    if (!this.adminClient) {
      throw new Error('Shopify Admin API client not configured')
    }

    this.fastify.log.info({ filename }, 'Uploading PDF to Shopify')

    try {
      // Step 1: Create staged upload
      const stagedUpload = await this.createStagedUpload(filename)

      // Step 2: Upload file to staged URL
      await this.uploadToStagedUrl(pdfBuffer, stagedUpload)

      this.fastify.log.info("just before file create");

      // Step 3: Create file record in Shopify
      const file = await this.createFileRecord(
        stagedUpload.resourceUrl,
        filename,
      )

      // Step 4: Wait for file URL to become available
      const fileUrl = await this.waitForFileUrl(file.id)

      this.fastify.log.info({ fileId: file.id, fileUrl }, 'PDF uploaded successfully and ready')

      return {
        ...file,
        url: fileUrl // Ensure we return the ready URL
      }
    } catch (error) {
      this.fastify.log.error({ error }, 'Failed to upload PDF to Shopify')
      throw new Error(`Shopify file upload failed: ${error.message}`)
    }
  }

  /**
   * Wait for file URL to become available after upload
   * Polls the file status until it's READY or FAILED
   * @param {string} fileId - File GID (e.g., gid://shopify/GenericFile/123)
   * @param {number} maxRetries - Maximum number of polling attempts (default: 10)
   * @param {number} delayMs - Delay between retries in milliseconds (default: 1000)
   * @returns {Promise<string>} File URL when ready
   */
  async waitForFileUrl(fileId, maxRetries = 10, delayMs = 1000) {
    this.fastify.log.info({ fileId, maxRetries, delayMs }, 'Waiting for file URL to become available')

    const query = `
      query node($id: ID!) {
        node(id: $id) {
          ... on GenericFile {
            id
            fileStatus
            url
            fileErrors {
              code
              message
            }
          }
        }
      }
    `

    let attempts = 0
    while (attempts < maxRetries) {
      const response = await this.adminClient.request(query, {
        variables: { id: fileId }
      })

      const file = response.data?.node

      // Check if file is ready
      if (file?.fileStatus === 'READY' && file?.url) {
        this.fastify.log.info({ fileId, url: file.url, attempts: attempts + 1 }, 'File URL is ready')
        return file.url
      }

      // Check if file failed
      if (file?.fileStatus === 'FAILED') {
        const errors = file?.fileErrors?.map(e => `${e.code}: ${e.message}`).join(', ')
        throw new Error(`File processing failed: ${errors || 'Unknown error'}`)
      }

      // Still processing (UPLOADED or PROCESSING status)
      attempts++
      if (attempts < maxRetries) {
        this.fastify.log.info({ 
          fileId, 
          status: file?.fileStatus, 
          attempts, 
          maxRetries 
        }, 'File not ready yet, waiting...')
        await new Promise(resolve => setTimeout(resolve, delayMs))
      }
    }

    throw new Error(
      `File ${fileId} did not become ready after ${maxRetries} attempts (${maxRetries * delayMs / 1000}s timeout)`
    )
  }

  /**
   * Step 1: Create staged upload parameters
   * @param {string} filename
   * @returns {Promise<Object>} Staged upload parameters
   */
  async createStagedUpload(filename) {
    this.fastify.log.info('Creating staged upload')

    const mutation = `
      mutation stagedUploadsCreate($input: [StagedUploadInput!]!) {
        stagedUploadsCreate(input: $input) {
          stagedTargets {
            url
            resourceUrl
            parameters {
              name
              value
            }
          }
          userErrors {
            field
            message
          }
        }
      }
    `

    const variables = {
      input: [
        {
          filename: filename,
          mimeType: 'FILE',
          resource: 'FILE',
          httpMethod: 'POST',
        }
      ]
    }

    const response = await this.adminClient.request(mutation, { variables })

    this.fastify.log.info({ response }, 'Staged upload created successfully')

    if (response.data?.stagedUploadsCreate?.userErrors?.length > 0) {
      const errors = response.data.stagedUploadsCreate.userErrors
      throw new Error(`Staged upload creation failed: ${errors.map(e => e.message).join(', ')}`)
    }

    const stagedTarget = response.data?.stagedUploadsCreate?.stagedTargets?.[0]
    if (!stagedTarget) {
      throw new Error('No staged target returned')
    }

    return stagedTarget
  }

  /**
   * Step 2: Upload file to staged URL
   * @param {Buffer} pdfBuffer
   * @param {Object} stagedUpload
   */
  async uploadToStagedUrl(pdfBuffer, stagedUpload) {
    this.fastify.log.info({ url: stagedUpload.url }, 'Uploading to staged URL')

    // Create form data
    const formData = new FormData()

    // Add parameters from staged upload
    stagedUpload.parameters.forEach(param => {
      formData.append(param.name, param.value)
    })

    // Add file (must be last)
    formData.append('file', pdfBuffer)

    // Upload to staged URL
    // const response = await fetch(stagedUpload.url, {
    //   method: 'POST',
    //   body: formData,
    //   headers: formData.getHeaders()
    // })

    this.fastify.log.info({}, "Uploading file to staged URL");
    
    await axios.post(stagedUpload.url, formData, {
      headers: {
        ...formData.getHeaders(),
      },
    });

    this.fastify.log.info('File uploaded to staged URL successfully')
  }

  /**
   * Step 3: Create file record in Shopify
   * @param {string} resourceUrl - URL from staged upload
   * @param {string} filename
   * @param {Object} metadata
   * @returns {Promise<Object>} File object
   */
  async createFileRecord(resourceUrl, filename, metadata = {}) {
    this.fastify.log.info('Creating file record in Shopify')

    const mutation = `
      mutation fileCreate($files: [FileCreateInput!]!) {
        fileCreate(files: $files) {
          files {
            ... on GenericFile {
              id
              url
              alt
              createdAt
            }
          }
          userErrors {
            field
            message
          }
        }
      }
    `

    const variables = {
      files: [
        {
          alt: metadata.alt || `Quote PDF - ${filename}`,
          contentType: 'FILE',
          originalSource: resourceUrl
        }
      ]
    }

    const response = await this.adminClient.request(mutation, { variables })

    if (response.data?.fileCreate?.userErrors?.length > 0) {
      const errors = response.data.fileCreate.userErrors
      throw new Error(`File creation failed: ${errors.map(e => e.message).join(', ')}`)
    }

    const file = response.data?.fileCreate?.files?.[0]
    if (!file) {
      throw new Error('No file returned from fileCreate')
    }

    return file
  }

  /**
   * Attach PDF URL to draft order via metafield (custom.quote_pdf)
   * Also sets a timestamp metafield (custom.quote_pdf_generated_at)
   * @param {string} draftOrderId - Draft order GID
   * @param {string} pdfUrl - PDF URL
   * @returns {Promise<Object>} Updated draft order
   */
  async attachFileToDraftOrder(draftOrderId, pdfUrl) {
    this.fastify.log.info({ draftOrderId, pdfUrl }, 'Attaching PDF URL to draft order metafield custom.quote_pdf')

    // Generate current timestamp in ISO 8601 format
    const timestamp = new Date().toISOString()

    const mutation = `
      mutation draftOrderUpdate($id: ID!, $input: DraftOrderInput!) {
        draftOrderUpdate(id: $id, input: $input) {
          draftOrder {
            id
            metafields(first: 10, namespace: "custom") {
              edges {
                node {
                  id
                  namespace
                  key
                  type
                  value
                }
              }
            }
          }
          userErrors {
            field
            message
          }
        }
      }
    `

    const variables = {
      id: draftOrderId,
      input: {
        metafields: [
          {
            namespace: 'custom',
            key: 'quote_pdf',
            type: 'url',
            value: pdfUrl
          },
          {
            namespace: 'custom',
            key: 'quote_pdf_generated_at',
            type: 'date_time',
            value: timestamp
          }
        ]
      }
    }

    const response = await this.adminClient.request(mutation, { variables })

    if (response.data?.draftOrderUpdate?.userErrors?.length > 0) {
      const errors = response.data.draftOrderUpdate.userErrors
      this.fastify.log.error({ errors, draftOrderId, pdfUrl }, 'Failed to attach PDF URL metafield to draft order')
      throw new Error(`Failed to attach PDF metafield: ${errors.map(e => e.message).join(', ')}`)
    }

    const draftOrder = response.data?.draftOrderUpdate?.draftOrder
    
    if (draftOrder) {
      this.fastify.log.info({ 
        draftOrderId: draftOrder.id,
        metafieldsCount: draftOrder.metafields?.edges?.length || 0,
        timestamp
      }, 'PDF URL metafield and timestamp attached successfully')
    }

    return draftOrder
  }

  /**
   * Add PDF URL to draft order note
   * @param {string} draftOrderId - Draft order GID
   * @param {string} pdfUrl - PDF URL
   * @param {string} existingNote - Existing note content
   * @returns {Promise<Object>} Updated draft order
   */
  async addPdfToNote(draftOrderId, pdfUrl, existingNote = '') {
    this.fastify.log.info({ draftOrderId }, 'Adding PDF URL to draft order note')

    const pdfNote = `\n\nQuote PDF: ${pdfUrl}`
    const newNote = existingNote ? `${existingNote}${pdfNote}` : pdfNote.trim()

    const mutation = `
      mutation draftOrderUpdate($id: ID!, $input: DraftOrderInput!) {
        draftOrderUpdate(id: $id, input: $input) {
          draftOrder {
            id
            note
          }
          userErrors {
            field
            message
          }
        }
      }
    `

    const variables = {
      id: draftOrderId,
      input: {
        note: newNote
      }
    }

    const response = await this.adminClient.request(mutation, { variables })

    if (response.data?.draftOrderUpdate?.userErrors?.length > 0) {
      const errors = response.data.draftOrderUpdate.userErrors
      this.fastify.log.warn({ errors }, 'Failed to update note with PDF URL')
      // Don't throw - note update is optional
    }

    return response.data?.draftOrderUpdate?.draftOrder
  }
}

module.exports = ShopifyFileService

