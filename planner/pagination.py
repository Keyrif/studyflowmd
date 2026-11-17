from rest_framework.pagination import PageNumberPagination


class NotePagination(PageNumberPagination):
    """Send notes in pages instead of all at once.

    GET /api/notes/?page=2 returns the second page. The response looks like
    {"count": 120, "next": "...?page=3", "previous": "...?page=1", "results": [...]},
    so the browser knows how many notes exist and whether there is more to load.
    """

    page_size = 30
    page_size_query_param = 'page_size'  # a client may ask for fewer or more per page...
    max_page_size = 100                    # ...but never more than this
