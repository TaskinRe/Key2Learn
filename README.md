# Key to Learn

A simple homework website. The teacher uploads HTML homework, and students open a link, type their name and do it. Students don't need an account or a sign-in.

## Put it online (one time, about 5 minutes)

1. On GitHub, click **New repository**. Name it, for example `key-to-learn`, set it to **Public**, and click **Create repository**.
2. Click **uploading an existing file**. Drag in **everything inside this folder**, including the `homework` and `.github` folders, then click **Commit changes**.
   - On a Mac, the `.github` folder is hidden in Finder. Press `Cmd + Shift + .` to show it.
3. Go to **Settings → Pages**. Under "Branch", choose `main` and `/ (root)`, then click **Save**.
4. Go to **Settings → Actions → General → Workflow permissions**. Choose **Read and write permissions** and click **Save**.
5. Wait 1 to 2 minutes. Your site is at `https://YOUR-USERNAME.github.io/key-to-learn/`

## Links

| Who | Link |
|---|---|
| Students | `https://YOUR-USERNAME.github.io/key-to-learn/` |
| Teacher | `https://YOUR-USERNAME.github.io/key-to-learn/?teacher` |

## How it works

- **Teacher uploads:** on the teacher page, click **Upload**. GitHub opens. Drag the homework file in and click **Commit changes**. Files up to 25 MB work. Students see the homework about 1 minute later.
- **Students:** open the link, type their name, pick the homework and do it. When they finish, they press **Save result file** or **Copy result code** and send it to the teacher by email or WhatsApp.
- **Teacher results:** on the teacher page, open **Results** and drag in the files or paste the codes. You'll see scores, time and mistakes, and you can download a spreadsheet.
- **Removing homework:** go to **Homework → Remove…**. This opens GitHub so you can delete the file.
- Delete `homework/sample-quiz.html` when you no longer need it.

## Settings (optional)

Edit `config.js` on GitHub (click the pencil icon):

- `teacherEmail`: adds an "Email my result" button for students.
- `githubOwner` / `githubRepo`: only needed if the Upload button says the link isn't set.

## Safety

- Homework runs in a locked-down frame. It cannot read the site, the student's name, or the teacher's results.
- Everything shown on screen is treated as plain text, so a file or result code can't inject code into the page.
- The browser only lets the page load its own files and talk to GitHub. This is set by the Content-Security-Policy.
- Results stay in the teacher's browser. Download the spreadsheet regularly to keep a copy.
- Limits to know about, because there is no database and no sign-in:
  - Anyone with the student link can open the homework.
  - The `?teacher` page is not password-protected. It only shows results that the teacher loaded into their own browser, and uploading still needs the teacher's GitHub login.
  - A student who knows how could edit a result code before sending it. Adding a database later fixes this.

## Making homework report scores (optional)

Any HTML file works. Students can always press **I am finished**. If you want automatic scores and mistakes, call this inside the game:

```js
HomeworkBridge.recordAnswer({ questionText: 'What is 8 x 7?', userAnswer: '54', correctAnswer: '56', isCorrect: false });
HomeworkBridge.finish({ score: 8, maxScore: 10 });
```
