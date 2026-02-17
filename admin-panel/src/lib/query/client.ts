import { QueryClient } from "@tanstack/react-query";
import { adminQueryDefaults } from "./config";

export const createAdminQueryClient = () =>
  new QueryClient({
    defaultOptions: adminQueryDefaults,
  });
