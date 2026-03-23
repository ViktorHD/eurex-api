from playwright.sync_api import sync_playwright

def test():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context(record_video_dir="videos/")
        page = context.new_page()

        print("Navigating to http://localhost:3000...")
        page.goto("http://localhost:3000")
        page.wait_for_selector("#toggleChatbotBtn", state="visible")
        print("Page loaded successfully.")

        # We can't actually call Gemini since we don't have an API key,
        # but we can try to inject a mock schema and API key so it attempts a request.
        # But even better, we can evaluate a script to just call the `getSchemaSummary` and see what it outputs!

        print("Mocking schema response to test getSchemaSummary...")
        mock_schema_data = {
            "__schema": {
                "types": [
                    {
                        "kind": "OBJECT",
                        "name": "Query",
                        "fields": [
                            {
                                "name": "product",
                                "args": [
                                    {"name": "id", "type": {"kind": "NON_NULL", "ofType": {"kind": "SCALAR", "name": "ID"}}}
                                ],
                                "type": {"kind": "OBJECT", "name": "Product"}
                            }
                        ]
                    },
                    {
                        "kind": "OBJECT",
                        "name": "Product",
                        "fields": [
                            {"name": "id", "args": [], "type": {"kind": "NON_NULL", "ofType": {"kind": "SCALAR", "name": "ID"}}},
                            {"name": "name", "args": [], "type": {"kind": "SCALAR", "name": "String"}}
                        ]
                    },
                    {
                        "kind": "INPUT_OBJECT",
                        "name": "ProductInput",
                        "inputFields": [
                            {"name": "name", "type": {"kind": "NON_NULL", "ofType": {"kind": "SCALAR", "name": "String"}}}
                        ]
                    },
                    {
                        "kind": "ENUM",
                        "name": "ProductType",
                        "enumValues": [
                            {"name": "PHYSICAL"},
                            {"name": "DIGITAL"}
                        ]
                    }
                ]
            }
        }

        script = f"""
            window.mockSchemaData = {str(mock_schema_data).replace("'", '"')};

            // Mock the fetchSchema function on the global client or somehow
            // Since we don't have direct access to the schemaExplorer instance from outside,
            // we will try to intercept the network request.
        """
        page.evaluate(script)

        # Intercept GraphQL requests
        def handle_route(route):
            if "graphql" in route.request.url.lower():
                route.fulfill(json={"data": mock_schema_data})
            else:
                route.continue_()

        page.route("**/*", handle_route)

        print("Opening API Settings Drawer to set API endpoint and key...")
        page.click("#drawerToggle")

        page.fill("#apiUrl", "http://mock.graphql")
        page.fill("#geminiApiKey", "dummy-key-for-test")

        print("Opening Docs to trigger schema fetch...")
        page.click("#toggleDocsBtn")
        page.wait_for_timeout(1000) # wait for fetch

        print("Opening Chatbot...")
        page.click("#toggleChatbotBtn")
        page.wait_for_selector("#chatbotInput", state="visible")

        page.fill("#chatbotInput", "Hello, explain the schema.")
        page.click("#sendChatbotBtn")

        # It should try to fetch the schema, run our schema summarizer, and then fail on the mock gemini api key.
        page.wait_for_timeout(2000)

        # Capture screenshot to verify it didn't completely crash and rendered correctly
        page.screenshot(path="screenshot.png")
        print("Screenshot saved to screenshot.png")

        context.close()
        browser.close()

test()
