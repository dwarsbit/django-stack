"""
Content Studio components for DjangoStack projects.

``PreviewButton`` opens an object on the site with drafts shown. The
object's path on the site comes from its ``get_absolute_url()``::

    from django_stack.studio import PreviewButton

    @register(Page)
    class PageStudio(ModelStudio):
        edit_sidebar = ["status", "published_at", PreviewButton()]
"""

from content_studio.form import ButtonLink

from .preview import preview_url


class PreviewButton(ButtonLink):
    label = "Preview"
    icon = "ph-bold ph-eye"

    def get_url(self, obj, request):
        get_path = getattr(obj, "get_absolute_url", None)
        path = get_path() if callable(get_path) else "/"
        return preview_url(path)
