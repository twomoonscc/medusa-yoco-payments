import crypto from "crypto"
import YocoPaymentService from "../services/yoco-payment"
import { YocoOptionsSchema, YocoPaymentError, YocoErrorCode } from "../types"

describe("YocoPaymentService", () => {
  let service: YocoPaymentService
  const mockLogger = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  }

  beforeEach(() => {
    jest.clearAllMocks()
  })

  describe("Configuration Validation", () => {
    it("should validate secretKey format", () => {
      const invalidConfig = {
        secretKey: "invalid_key",
      }

      const result = YocoOptionsSchema.safeParse(invalidConfig)
      expect(result.success).toBe(false)
    })

    it("should accept valid test secret key", () => {
      const validConfig = {
        secretKey: "sk_test_1234567890",
        debug: false,
      }

      const result = YocoOptionsSchema.safeParse(validConfig)
      expect(result.success).toBe(true)
    })

    it("should accept valid live secret key", () => {
      const validConfig = {
        secretKey: "sk_live_1234567890",
      }

      const result = YocoOptionsSchema.safeParse(validConfig)
      expect(result.success).toBe(true)
    })

    it("should validate redirect URLs", () => {
      const invalidConfig = {
        secretKey: "sk_test_1234567890",
        successUrl: "not-a-url",
      }

      const result = YocoOptionsSchema.safeParse(invalidConfig)
      expect(result.success).toBe(false)
    })

    it("should accept valid redirect URLs", () => {
      const validConfig = {
        secretKey: "sk_test_1234567890",
        successUrl: "https://example.com/success",
        cancelUrl: "https://example.com/cancel",
        failureUrl: "https://example.com/failure",
      }

      const result = YocoOptionsSchema.safeParse(validConfig)
      expect(result.success).toBe(true)
    })
  })

  describe("Service Initialization", () => {
    it("should throw error for invalid configuration", () => {
      expect(() => {
        new YocoPaymentService({ logger: mockLogger }, { secretKey: "invalid" } as any)
      }).toThrow("Configuration validation failed")
    })

    it("should initialize with valid configuration", () => {
      const service = new YocoPaymentService({ logger: mockLogger }, {
        secretKey: "sk_test_1234567890",
        debug: true,
      })

      expect(service).toBeDefined()
      expect(mockLogger.info).toHaveBeenCalledWith("[Yoco] Initialized with validated configuration")
    })
  })

  describe("YocoPaymentError", () => {
    it("should create error from Yoco API error", () => {
      const yocoError = {
        errorCode: "card_declined",
        errorMessage: "Card was declined",
        displayMessage: "Your card was declined",
      }

      const error = YocoPaymentError.fromYocoError(yocoError)

      expect(error).toBeInstanceOf(YocoPaymentError)
      expect(error.message).toBe("Your card was declined")
      expect(error.code).toBe(YocoErrorCode.CARD_DECLINED)
    })

    it("should map unknown error codes to API_ERROR", () => {
      const yocoError = {
        errorCode: "unknown_error",
        errorMessage: "Something went wrong",
      }

      const error = YocoPaymentError.fromYocoError(yocoError)

      expect(error.code).toBe(YocoErrorCode.API_ERROR)
    })

    it("should handle missing displayMessage", () => {
      const yocoError = {
        errorCode: "processing_error",
        errorMessage: "Processing failed",
      }

      const error = YocoPaymentError.fromYocoError(yocoError)

      expect(error.message).toBe("Processing failed")
    })
  })

  describe("Payment Amount Validation", () => {
    beforeEach(() => {
      service = new YocoPaymentService({ logger: mockLogger }, {
        secretKey: "sk_test_1234567890",
        debug: false,
      })

      // Mock the API method
      ;(service as any).api = jest.fn()
    })

    it("should reject amounts below minimum", async () => {
      const input = {
        amount: 1, // R1.00 - below minimum
        currency_code: "ZAR",
        context: {},
      }

      await expect(service.initiatePayment(input)).rejects.toThrow("Minimum amount is R2.00")
    })

    it("should reject non-ZAR currency", async () => {
      const input = {
        amount: 10,
        currency_code: "USD",
        context: {},
      }

      await expect(service.initiatePayment(input)).rejects.toThrow("Only ZAR currency is supported")
    })
  })

  describe("Amount units", () => {
    beforeEach(() => {
      service = new YocoPaymentService({ logger: mockLogger }, {
        secretKey: "sk_test_1234567890",
        debug: false,
      })
    })

    const checkout = { id: "ch_1", redirectUrl: "https://pay.yoco.com/ch_1", status: "created" }

    it("sends Medusa major units to Yoco as cents when initiating", async () => {
      const api = jest.fn().mockResolvedValue(checkout)
      ;(service as any).api = api

      await service.initiatePayment({ amount: 270.85, currency_code: "ZAR", context: {} })

      expect(api.mock.calls[0][2]).toMatchObject({ amount: 27085 })
    })

    it("sends Medusa major units to Yoco as cents when updating", async () => {
      const api = jest.fn().mockResolvedValue(checkout)
      ;(service as any).api = api

      await service.updatePayment({ amount: 10, currency_code: "ZAR", context: {}, data: {} })

      expect(api.mock.calls[0][2]).toMatchObject({ amount: 1000 })
    })

    it("refunds in cents", async () => {
      const api = jest.fn().mockResolvedValue({ refundId: "r_1", status: "successful", message: "ok" })
      ;(service as any).api = api

      await service.refundPayment({ amount: 50.5, data: { yocoCheckoutId: "ch_1" } })

      expect(api.mock.calls[0][2]).toEqual({ amount: 5050 })
    })

  })

  describe("Session id", () => {
    const checkout = { id: "ch_1", redirectUrl: "https://pay.yoco.com/ch_1", status: "created" }

    beforeEach(() => {
      service = new YocoPaymentService({ logger: mockLogger }, {
        secretKey: "sk_test_1234567890",
        debug: false,
      })
    })

    it("reads the session id from data.session_id on initiate", async () => {
      const api = jest.fn().mockResolvedValue(checkout)
      ;(service as any).api = api

      const result = await service.initiatePayment({
        amount: 10,
        currency_code: "ZAR",
        data: { session_id: "payses_1" },
        context: {},
      })

      expect(api.mock.calls[0][2]).toMatchObject({
        externalId: "payses_1",
        metadata: { session_id: "payses_1" },
      })
      expect(api.mock.calls[0][3]).toBe("initiate-payses_1-1000")
      expect(result.data).toMatchObject({ session_id: "payses_1" })
    })

    it("falls back to context.idempotency_key", async () => {
      const api = jest.fn().mockResolvedValue(checkout)
      ;(service as any).api = api

      await service.updatePayment({
        amount: 10,
        currency_code: "ZAR",
        data: {},
        context: { idempotency_key: "payses_2" },
      })

      expect(api.mock.calls[0][2]).toMatchObject({ externalId: "payses_2" })
    })

    it("does not share an idempotency key when the session id is missing", async () => {
      const api = jest.fn().mockResolvedValue(checkout)
      ;(service as any).api = api
      const input = { amount: 10, currency_code: "ZAR", context: {} }

      await service.initiatePayment(input)
      await service.initiatePayment(input)

      expect(api.mock.calls[0][3]).not.toBe(api.mock.calls[1][3])
    })
  })

  describe("Webhooks", () => {
    const SECRET = "whsec_" + Buffer.from("test-secret-bytes").toString("base64")

    const signed = (body: string, secret = SECRET) => {
      const id = "msg_1"
      const timestamp = String(Math.floor(Date.now() / 1000))
      const key = Buffer.from(secret.replace(/^whsec_/, ""), "base64")
      const sig = crypto.createHmac("sha256", key).update(`${id}.${timestamp}.${body}`).digest("base64")
      return {
        rawData: body,
        data: JSON.parse(body),
        headers: { "webhook-id": id, "webhook-timestamp": timestamp, "webhook-signature": `v1,${sig}` },
      } as any
    }

    const makeService = (webhookSecret?: string) =>
      new YocoPaymentService({ logger: mockLogger }, {
        secretKey: "sk_test_1234567890",
        webhookSecret,
        debug: false,
      })

    const succeeded = JSON.stringify({
      type: "payment.succeeded",
      payload: { amount: 27085, metadata: { session_id: "payses_1" } },
    })

    it("reports a verified webhook amount in major units", async () => {
      const result = await makeService(SECRET).getWebhookActionAndData(signed(succeeded))

      expect(result).toEqual({
        action: "authorized",
        data: { session_id: "payses_1", amount: 270.85 },
      })
    })

    it("maps payment.failed to failed", async () => {
      const body = succeeded.replace("payment.succeeded", "payment.failed")
      const result = await makeService(SECRET).getWebhookActionAndData(signed(body))

      expect(result.action).toBe("failed")
    })

    it("ignores a webhook with a bad signature", async () => {
      const other = "whsec_" + Buffer.from("other").toString("base64")
      const result = await makeService(SECRET).getWebhookActionAndData(signed(succeeded, other))

      expect(result).toEqual({ action: "not_supported" })
      expect(mockLogger.warn).toHaveBeenCalledWith("[Yoco] Webhook ignored: invalid signature")
    })

    it("ignores webhooks when no webhookSecret is configured", async () => {
      const result = await makeService().getWebhookActionAndData(signed(succeeded))

      expect(result).toEqual({ action: "not_supported" })
      expect(mockLogger.warn).toHaveBeenCalledWith("[Yoco] Webhook ignored: no webhookSecret configured")
    })
  })
})
