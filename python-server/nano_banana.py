from PIL import Image
import logging
from typing import Any

logger = logging.getLogger(__name__)

class NanoBananaProcessor:
    def __init__(self):
        logger.info("NanoBananaProcessor (stub) initialized")

    def is_ready(self) -> bool:
        return True

    async def generate_image(self, mesh: Any, background: Image.Image) -> Image.Image:
        """Stub: simply returns the background image.
        In real implementation, this would render the edited mesh to an 'after' image.
        """
        return background.copy()

