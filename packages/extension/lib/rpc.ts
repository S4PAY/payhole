import { browser } from "wxt/browser";
import { API_KIND, type Api, type ApiName, type ApiRequest, type ApiResponse } from "./messages";

/** Sends one typed request to the background and unwraps the response. */
export async function call<K extends ApiName>(type: K, params: Api[K]["params"]): Promise<Api[K]["result"]> {
  const request: ApiRequest<K> = { kind: API_KIND, type, params };
  const response = await browser.runtime.sendMessage<ApiRequest<K>, ApiResponse<K> | undefined>(request);
  if (!response) throw new Error("no response from the background");
  if (!response.ok) throw new Error(response.error);
  return response.result;
}
