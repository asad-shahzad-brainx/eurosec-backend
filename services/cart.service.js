'use strict'

/**
 * Cart Service
 * Handles cart operations using Shopify Storefront API
 */
class CartService {
  constructor(fastify) {
    this.fastify = fastify
    this.storefrontClient = fastify.shopify.storefront
  }

  /**
   * Fetch cart data using cart token
   * @param {string} cartToken - The cart token
   * @returns {Promise<Object>} Cart data
   */
  async fetchCartByToken(cartToken) {
    if (!this.storefrontClient) {
      throw new Error('Storefront API client not configured')
    }

    if (!cartToken) {
      throw new Error('Cart token is required')
    }

    this.fastify.log.info({ cartToken }, 'Fetching cart from Storefront API')

    try {
      // Convert cart token to cart ID format
      // Cart tokens can be in format: "c1-..." or a full GID
      const cartId = cartToken.startsWith('gid://') 
        ? cartToken 
        : `gid://shopify/Cart/${cartToken}`

      const query = `
        query getCart($cartId: ID!) {
          cart(id: $cartId) {
            id
            createdAt
            updatedAt
            totalQuantity
            checkoutUrl
            note
            buyerIdentity {
              email
              phone
              customer {
                id
                email
                firstName
                lastName
                phone
              }
            }
            lines(first: 100) {
              edges {
                node {
                  id
                  quantity
                  merchandise {
                    ... on ProductVariant {
                      id
                      title
                      sku
                      price {
                        amount
                        currencyCode
                      }
                      product {
                        id
                        title
                        handle
                      }
                      image {
                        url
                        altText
                      }
                    }
                  }
                  attributes {
                    key
                    value
                  }
                }
              }
            }
            cost {
              totalAmount {
                amount
                currencyCode
              }
              subtotalAmount {
                amount
                currencyCode
              }
              totalTaxAmount {
                amount
                currencyCode
              }
            }
            discountCodes {
              code
              applicable
            }
            deliveryGroups(first: 1) {
              edges {
                node {
                  deliveryAddress {
                    ... on MailingAddress {
                      firstName
                      lastName
                      address1
                      address2
                      city
                      province
                      provinceCode
                      country
                      countryCodeV2
                      zip
                      phone
                      company
                    }
                  }
                }
              }
            }
          }
        }
      `

      const response = await this.storefrontClient.request(query, {
        variables: { cartId }
      })

      if (!response.data?.cart) {
        this.fastify.log.warn({ cartToken, cartId }, 'Cart not found')
        return null
      }

      this.fastify.log.info({ cartId: response.data.cart.id }, 'Cart fetched successfully')
      return response.data.cart
    } catch (error) {
      this.fastify.log.error({ error, cartToken }, 'Failed to fetch cart')
      throw new Error(`Failed to fetch cart: ${error.message}`)
    }
  }

  /**
   * Transform Storefront cart data to a format compatible with payload
   * @param {Object} cart - Cart data from Storefront API
   * @returns {Object} Transformed cart data
   */
  transformCartToPayload(cart) {
    const cartLines = cart.lines.edges.map(({ node }) => {
      const variant = node.merchandise
      return {
        id: node.id,
        quantity: node.quantity,
        title: variant.product.title,
        variantTitle: variant.title,
        price: parseFloat(variant.price.amount),
        image: variant.image?.url || '',
        productId: variant.product.id,
        variantId: variant.id,
        sku: variant.sku || '',
        properties: node.attributes.map(attr => ({
          key: attr.key,
          value: attr.value
        }))
      }
    })

    const customer = cart.buyerIdentity?.customer || {}
    const deliveryAddress = cart.deliveryGroups?.edges[0]?.node?.deliveryAddress || {}

    return {
      cartLines,
      customer: {
        id: customer.id,
        email: customer.email || cart.buyerIdentity?.email,
        firstName: customer.firstName || '',
        lastName: customer.lastName || '',
        phone: customer.phone || cart.buyerIdentity?.phone || ''
      },
      pricing: {
        subtotal: parseFloat(cart.cost.subtotalAmount.amount),
        total: parseFloat(cart.cost.totalAmount.amount),
        currency: cart.cost.totalAmount.currencyCode,
        discountCodes: cart.discountCodes
          .filter(dc => dc.applicable)
          .map(dc => dc.code)
      },
      shippingAddress: {
        firstName: deliveryAddress.firstName || '',
        lastName: deliveryAddress.lastName || '',
        address1: deliveryAddress.address1 || '',
        address2: deliveryAddress.address2 || '',
        city: deliveryAddress.city || '',
        province: deliveryAddress.province || '',
        provinceCode: deliveryAddress.provinceCode || '',
        country: deliveryAddress.country || '',
        countryCode: deliveryAddress.countryCodeV2 || '',
        zip: deliveryAddress.zip || '',
        phone: deliveryAddress.phone || '',
        company: deliveryAddress.company || ''
      },
      note: cart.note || null
    }
  }
}

module.exports = CartService

