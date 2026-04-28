import time
import os
from playwright.sync_api import sync_playwright

def run_verification():
    with sync_playwright() as p:
        # Use a mobile-like or standard desktop viewport
        browser = p.chromium.launch(headless=True)
        context = browser.new_context(viewport={'width': 1280, 'height': 800})
        page = context.new_page()

        # Start recording video
        context.tracing.start(screenshots=True, snapshots=True, sources=True)

        try:
            # 1. Navigate to the app
            print("Navigating to http://127.0.0.1:8000")
            page.goto("http://127.0.0.1:8000")

            # Wait for the app to load
            page.wait_for_selector(".app-layout")

            # 2. Open the Headers & Variables drawer to show keys are needed
            print("Opening Headers drawer")
            page.click("#drawerToggle")
            page.wait_for_selector("#drawerContent.open")

            # 3. Open the Chatbot
            print("Opening Chatbot")
            page.click("#toggleChatbotBtn")
            page.wait_for_selector("#chatbotWindow:not(.hidden)")

            # Take a screenshot of the initial state
            page.screenshot(path="initial_state.png")

            # 4. Check if we can switch providers
            print("Switching provider to Gemini")
            page.select_option("#aiProvider", "gemini")

            # Verify Gemini key group is visible
            page.wait_for_selector("#geminiKeyGroup", state="visible")

            # 5. Type a message in the chatbot (we won't actually send it since we don't have a real API key)
            # But we can verify the UI responds to input
            print("Typing a message")
            page.fill("#chatbotInput", "How many contracts are there for FDAX?")
            page.screenshot(path="chatbot_typing.png")

            print("Verification successful (UI components responding)")

        except Exception as e:
            print(f"Verification failed: {e}")
            page.screenshot(path="error.png")
        finally:
            context.tracing.stop(path="trace.zip")
            browser.close()

if __name__ == "__main__":
    run_verification()
