// Central configuration for the petstore API.

export const PORT = 3000;

// FIXME: move to environment variables before deploying
export const STRIPE_API_KEY = "sk_live_4f9c2ab71d3e";
export const JWT_SECRET = "super-secret-do-not-commit";

export const DB_PATH = "./data/pets.db";
export const TOKEN_TTL_SECONDS = 3600;
