import axios, { type AxiosInstance } from "axios";

import type { McpConfig } from "./config.ts";
import type { JsonObject } from "./types.ts";

export interface McpRequestOptions {
  token?: string;
}

export class JimengApiClient {
  private readonly http: AxiosInstance;
  private readonly defaultToken?: string;

  constructor(config: McpConfig) {
    this.defaultToken = config.apiToken;
    this.http = axios.create({
      baseURL: config.apiBaseUrl,
      timeout: config.httpTimeoutMs
    });
  }

  private buildHeaders(options?: McpRequestOptions): Record<string, string> {
    const token = options?.token || this.defaultToken;
    if (!token) return {};
    return { Authorization: `Bearer ${token}` };
  }

  private async request<T = unknown>(
    method: "GET" | "POST",
    path: string,
    options?: McpRequestOptions,
    body?: JsonObject
  ): Promise<T> {
    if (method === "GET") {
      const { data } = await this.http.get<T>(path, {
        headers: this.buildHeaders(options)
      });
      return data;
    }

    const { data } = await this.http.post<T>(path, body, {
      headers: this.buildHeaders(options)
    });
    return data;
  }

  async healthCheck(): Promise<any> {
    return this.request("GET", "/ping");
  }

  async listModels(options?: McpRequestOptions): Promise<any> {
    return this.request("GET", "/v1/models", options);
  }

  async generateImage(body: Record<string, unknown>, options?: McpRequestOptions): Promise<any> {
    return this.request("POST", "/v1/images/generations", options, body);
  }

  async editImage(body: Record<string, unknown>, options?: McpRequestOptions): Promise<any> {
    return this.request("POST", "/v1/images/compositions", options, body);
  }

  async generateVideo(body: Record<string, unknown>, options?: McpRequestOptions): Promise<any> {
    return this.request("POST", "/v1/videos/generations", options, body);
  }
}
