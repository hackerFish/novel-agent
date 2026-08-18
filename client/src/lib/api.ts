/**
 * 安全解析 API 响应，避免空或非 JSON 导致 "Unexpected end of JSON input"
 */
export async function parseJsonResponse<T = unknown>(res: Response): Promise<T> {
  const text = await res.text()
  if (!text.trim()) {
    throw new Error(res.ok ? '服务器未返回内容。' : `请求失败 ${res.status}，无响应体。请检查后端是否正常运行。`)
  }
  try {
    return JSON.parse(text) as T
  } catch {
    throw new Error(`服务器返回了无效数据（非 JSON）。${res.status ? `状态码: ${res.status}` : ''} ${text.slice(0, 80)}`)
  }
}
