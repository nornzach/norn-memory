// Badge colours for HTTP status codes and methods, shared by the Requests, Webhooks and Analytics pages.

export const getStatusClassName = (statusCode: number) => {
  if (statusCode >= 500) return "border-transparent bg-danger-soft text-danger";
  if (statusCode >= 400)
    return "border-transparent bg-warning-soft text-warning";
  return "border-transparent bg-success-soft text-success";
};

export const getMethodClassName = (method: string) => {
  switch (method.toUpperCase()) {
    case "POST":
      return "border-transparent bg-info-soft text-info";
    case "PUT":
    case "PATCH":
      return "border-transparent bg-warning-soft text-warning";
    case "DELETE":
      return "border-transparent bg-danger-soft text-danger";
    default:
      return "border-line bg-panel text-ink-2";
  }
};
