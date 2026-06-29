CREATE TABLE "SecurityQuestion" (
    "id"         TEXT NOT NULL,
    "userId"     TEXT NOT NULL,
    "question"   TEXT NOT NULL,
    "answerHash" TEXT NOT NULL,
    "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SecurityQuestion_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SecurityQuestion_userId_question_key" ON "SecurityQuestion"("userId", "question");
CREATE INDEX "SecurityQuestion_userId_idx" ON "SecurityQuestion"("userId");

ALTER TABLE "SecurityQuestion" ADD CONSTRAINT "SecurityQuestion_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
