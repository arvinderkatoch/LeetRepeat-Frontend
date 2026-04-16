/**
 * API Client with retry logic, timeout, and error handling
 */

const API_BASE = process.env.REACT_APP_API_BASE || "http://localhost:8000/api";

class ApiError extends Error {
  constructor(statusCode, message, context = {}) {
    super(message);
    this.statusCode = statusCode;
    this.context = context;
  }

  static fromResponse(statusCode, data) {
    const message = data?.error || "An error occurred";
    return new ApiError(statusCode, message, data);
  }
}

/**
 * Session management utilities
 */
const sessionManager = {
  getToken: () => localStorage.getItem("token") || "",
  
  setToken: (token) => {
    localStorage.setItem("token", token);
  },

  getUser: () => {
    const user = localStorage.getItem("user");
    return user ? JSON.parse(user) : null;
  },

  setUser: (user) => {
    localStorage.setItem("user", JSON.stringify(user));
  },

  clearSession: () => {
    localStorage.removeItem("token");
    localStorage.removeItem("user");
  },

  isSessionValid: () => {
    return !!localStorage.getItem("token");
  },
};

/**
 * Retry wrapper with exponential backoff
 */
async function withRetry(
  fn,
  maxRetries = 3,
  baseDelay = 500,
  backoffMultiplier = 2
) {
  let lastError;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;

      // Don't retry on auth errors, validation errors, or 404
      if (
        err.statusCode === 401 ||
        err.statusCode === 403 ||
        err.statusCode === 400 ||
        err.statusCode === 404
      ) {
        throw err;
      }

      // Don't retry on last attempt
      if (attempt === maxRetries - 1) {
        break;
      }

      // Wait before retry with exponential backoff
      const delay = baseDelay * Math.pow(backoffMultiplier, attempt);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  throw lastError;
}

/**
 * Fetch helper with timeout, retry, and error handling
 */
async function fetchWithTimeout(
  url,
  options = {},
  timeoutMs = 10000,
  retries = 2
) {
  return withRetry(
    async () => {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

      try {
        const response = await fetch(url, {
          ...options,
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        const data = await response.json().catch(() => ({}));

        if (!response.ok) {
          throw ApiError.fromResponse(response.status, data);
        }

        return data;
      } finally {
        clearTimeout(timeoutId);
      }
    },
    retries
  );
}

/**
 * API Client
 */
const apiClient = {
  /**
   * Authentication endpoints
   */
  auth: {
    register: async (name, email, password) => {
      return fetchWithTimeout(
        `${API_BASE}/auth/register`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name, email, password }),
        },
        10000,
        1 // No retry for registration
      );
    },

    login: async (email, password) => {
      return fetchWithTimeout(
        `${API_BASE}/auth/login`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email, password }),
        },
        10000,
        1 // No retry for login
      );
    },

    googleAuth: async (idToken) => {
      return fetchWithTimeout(
        `${API_BASE}/auth/google`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ idToken }),
        },
        10000,
        1 // No retry for auth
      );
    },
  },

  /**
   * Questions endpoints
   */
  questions: {
    /**
     * Get all questions with pagination and filtering
     * @param {Object} params - Query parameters
     * @param {string} params.status - 'active' or 'archived'
     * @param {string} params.difficulty - 'Easy', 'Medium', 'Hard', or 'All'
     * @param {string} params.search - Search term
     * @param {string} params.sortBy - Sort field
     * @param {string} params.order - 'asc' or 'desc'
     * @param {number} params.page - Page number (default: 1)
     * @param {number} params.limit - Items per page (default: 25)
     */
    getAll: async (params = {}) => {
      const query = new URLSearchParams();
      query.set("status", params.status || "active");
      if (params.difficulty && params.difficulty !== "All") {
        query.set("difficulty", params.difficulty);
      }
      if (params.search) query.set("search", params.search);
      query.set("sortBy", params.sortBy || "next_review_at");
      query.set("order", params.order || "asc");
      query.set("page", params.page || 1);
      query.set("limit", params.limit || 25);

      const token = sessionManager.getToken();
      return fetchWithTimeout(
        `${API_BASE}/questions?${query}`,
        {
          headers: { Authorization: `Bearer ${token}` },
        },
        10000,
        2 // Retry once on network failure
      );
    },

    /**
     * Create a new question
     */
    create: async (title, link, difficulty) => {
      const token = sessionManager.getToken();
      return fetchWithTimeout(
        `${API_BASE}/questions`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ title, link, difficulty }),
        },
        10000,
        1 // No retry for creation
      );
    },

    /**
     * Mark question as reviewed
     */
    markReviewed: async (questionId, minutes, quality) => {
      const token = sessionManager.getToken();
      return fetchWithTimeout(
        `${API_BASE}/questions/${questionId}/review`,
        {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ minutes, quality }),
        },
        10000,
        2
      );
    },

    /**
     * Archive a question
     */
    archive: async (questionId) => {
      const token = sessionManager.getToken();
      return fetchWithTimeout(
        `${API_BASE}/questions/${questionId}/archive`,
        {
          method: "PATCH",
          headers: { Authorization: `Bearer ${token}` },
        },
        10000,
        2
      );
    },

    /**
     * Restore an archived question
     */
    restore: async (questionId) => {
      const token = sessionManager.getToken();
      return fetchWithTimeout(
        `${API_BASE}/questions/${questionId}/restore`,
        {
          method: "PATCH",
          headers: { Authorization: `Bearer ${token}` },
        },
        10000,
        2
      );
    },

    /**
     * Delete a question permanently
     */
    delete: async (questionId) => {
      const token = sessionManager.getToken();
      return fetchWithTimeout(
        `${API_BASE}/questions/${questionId}`,
        {
          method: "DELETE",
          headers: { Authorization: `Bearer ${token}` },
        },
        10000,
        1 // No retry for deletion
      );
    },
  },
};

/**
 * Error formatter for UI display
 */
function formatErrorMessage(error, fallback = "An error occurred") {
  if (error instanceof ApiError) {
    return error.message;
  }

  if (error instanceof TypeError && error.message.includes("Failed to fetch")) {
    return "Network error. Please check your connection.";
  }

  if (error instanceof DOMException && error.name === "AbortError") {
    return "Request took too long. Please try again.";
  }

  return fallback;
}

export { apiClient, sessionManager, ApiError, formatErrorMessage };
