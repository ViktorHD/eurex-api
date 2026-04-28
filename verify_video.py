import time
import os
from playwright.sync_api import sync_playwright

def run_verification():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        # Record video
        context = browser.new_context(
            viewport={'width': 1280, 'height': 800},
            record_video_dir="videos/"
        )
        page = context.new_page()

        try:
            print("Navigating to http://127.0.0.1:8000")
            page.goto("http://127.0.0.1:8000")
            page.wait_for_selector(".app-layout")

            print("Opening Headers drawer")
            page.click("#drawerToggle")
            page.wait_for_selector("#drawerContent.open")

            print("Opening Chatbot")
            page.click("#toggleChatbotBtn")
            page.wait_for_selector("#chatbotWindow:not(.hidden)")

            print("Switching provider to Gemini")
            page.select_option("#aiProvider", "gemini")
            page.wait_for_selector("#geminiKeyGroup", state="visible")

            print("Typing a message")
            page.fill("#chatbotInput", "How many contracts are there for FDAX?")
            time.sleep(1) # Wait a bit for the video to catch it

            print("Verification successful")

        except Exception as e:
            print(f"Verification failed: {e}")
        finally:
            context.close() # Important to save the video
            browser.close()

if __name__ == "__main__":
    if not os.path.exists("videos"):
        os.makedirs("videos")
    run_verification()
    # Find the video file
    video_files = os.listdir("videos")
    if video_files:
        print(f"Video recorded: videos/{video_files[0]}")
