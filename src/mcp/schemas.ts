import * as z from "zod";

export const healthCheckInputSchema = {};

export const listModelsInputSchema = {
  token: z.string().optional()
};

export const generateImageInputSchema = {
  prompt: z.string().min(1),
  model: z.string().optional(),
  negative_prompt: z.string().optional(),
  ratio: z.string().optional(),
  resolution: z.string().optional(),
  intelligent_ratio: z.boolean().optional(),
  sample_strength: z.number().optional(),
  response_format: z.enum(["url", "b64_json"]).optional(),
  token: z.string().optional(),
  confirm: z.string().optional()
};

export const editImageInputSchema = {
  prompt: z.string().min(1),
  images: z.array(z.string().url()).min(1).max(10),
  model: z.string().optional(),
  negative_prompt: z.string().optional(),
  ratio: z.string().optional(),
  resolution: z.string().optional(),
  intelligent_ratio: z.boolean().optional(),
  sample_strength: z.number().optional(),
  response_format: z.enum(["url", "b64_json"]).optional(),
  token: z.string().optional(),
  confirm: z.string().optional()
};

export const generateVideoInputSchema = {
  prompt: z.string().min(1),
  model: z.string().optional(),
  ratio: z.string().optional(),
  resolution: z.string().optional(),
  duration: z.number().int().min(4).max(15).optional(),
  token: z.string().optional(),
  confirm: z.string().optional()
};
