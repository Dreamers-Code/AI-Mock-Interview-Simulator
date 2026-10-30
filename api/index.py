import os
import sys
from urllib.parse import parse_qs

# Ensure the root directory is on the Python path
root_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if root_dir not in sys.path:
    sys.path.insert(0, root_dir)

from app import app

class VercelPathMiddleware:
    """Restores the original request path from the __path query parameter or Vercel headers."""
    def __init__(self, wsgi_app):
        self.wsgi_app = wsgi_app

    def __call__(self, environ, start_response):
        # 1. Check query parameter __path
        qs = environ.get("QUERY_STRING", "")
        if "__path" in qs:
            params = parse_qs(qs)
            if "__path" in params and params["__path"]:
                environ["PATH_INFO"] = params["__path"][0]
        # 2. Fallback to header
        elif "HTTP_X_MATCHED_PATH" in environ:
            environ["PATH_INFO"] = environ["HTTP_X_MATCHED_PATH"]
        elif "HTTP_X_FORWARDED_URI" in environ:
            environ["PATH_INFO"] = environ["HTTP_X_FORWARDED_URI"]

        return self.wsgi_app(environ, start_response)

app.wsgi_app = VercelPathMiddleware(app.wsgi_app)
