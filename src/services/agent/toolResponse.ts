/**
 * Standardized error response format for all agent tools.
 * Ensures consistent error handling across the system.
 */
export interface ToolErrorResponse {
  error: string
  code?: string
  details?: Record<string, any>
}

export interface ToolSuccessResponse {
  success: true
  message?: string
  data?: any
}

export type ToolResponse = ToolErrorResponse | ToolSuccessResponse

/**
 * Create a standardized error response.
 */
export function createErrorResponse(
  error: string,
  code?: string,
  details?: Record<string, any>
): ToolErrorResponse {
  return {
    error,
    ...(code && { code }),
    ...(details && { details }),
  }
}

/**
 * Create a standardized success response.
 */
export function createSuccessResponse(
  message?: string,
  data?: any
): ToolSuccessResponse {
  return {
    success: true,
    ...(message && { message }),
    ...(data && { data }),
  }
}
