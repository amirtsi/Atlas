from app.modules.communication.intent import classify_intent


def test_english_question():
    assert classify_intent("what did I do this week?") == "question"


def test_hebrew_question():
    assert classify_intent("כמה זמן התאמנתי השבוע?") == "question"


def test_plain_log_is_not_a_question():
    assert classify_intent("עשיתי פיזיותרפיה 30 דקות") == "log"


def test_hebrew_word_containing_question_substring_is_log():
    # "סיימתי" contains the substring "מתי" (when) but is not a question.
    assert classify_intent("סיימתי") == "log"


def test_empty_is_other():
    assert classify_intent("   ") == "other"
