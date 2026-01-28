import logging

logger = logging.getLogger(__name__)


def grade_attempt(payload: dict) -> dict:
    text_response = payload.get("textResponse")
    rubric_json = payload.get("rubricJson")
    max_score = payload.get("maxScore", 0)

    if not rubric_json or not isinstance(rubric_json, dict):
        return {
            "score": 0,
            "feedback": "Manual review required.",
            "gradedBy": "auto",
        }

    answer_key = rubric_json.get("answer_key")
    if not answer_key or not isinstance(answer_key, list):
        return {
            "score": 0,
            "feedback": "Manual review required.",
            "gradedBy": "auto",
        }

    if not text_response:
        return {
            "score": 0,
            "feedback": "No response provided.",
            "gradedBy": "auto",
        }

    student_answer = text_response.strip().lower()

    for key in answer_key:
        if isinstance(key, str) and key.strip().lower() == student_answer:
            logger.info("Answer matched: '%s'", key)
            return {
                "score": max_score,
                "feedback": "Correct!",
                "gradedBy": "auto",
            }

    logger.info("No match found for answer: '%s'", text_response)
    return {
        "score": 0,
        "feedback": "Incorrect. Review the material.",
        "gradedBy": "auto",
    }
