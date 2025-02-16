import { GoogleAuth } from "google-auth-library";
import { google } from "googleapis";
import { parse } from "node-html-parser";
import dotenv from "dotenv";

dotenv.config();

const site = "https://jobs.makesense.org";

const auth = new GoogleAuth({
  credentials: {
    type: "service_account",
    project_id: process.env.PROJECT_ID,
    private_key_id: process.env.PRIVATE_KEY_ID,
    private_key: process.env.PRIVATE_KEY,
    client_email: process.env.CLIENT_EMAIL,
    client_id: process.env.CLIENT_ID,
    universe_domain: "googleapis.com",
  },
  scopes: "https://www.googleapis.com/auth/spreadsheets",
});

const service = google.sheets({ version: "v4", auth });

const getJob = async (link: string) => {
  const response = await fetch(link);
  const html = await response.text();
  const root = parse(html);

  const title = root
    .querySelector("h2.job__title")
    ?.text.replace(/\n/g, "")
    .trim();

  const publishedDate = root
    .querySelectorAll("div.spacer__item")
    .find((div) => div.text.trim().startsWith("Publiée le"))
    ?.text.trim()
    .replace("Publiée le ", "");

  const entreprise = root
    .querySelector("h2.project__name")
    ?.text.replace(/\n/g, "")
    .trim();

  const website = root
    .querySelectorAll("a")
    .find((a) => a.text.trim() === "Site internet")
    ?.getAttribute("href");

  const type = root
    .querySelectorAll("div.meta")
    .filter((div) => div.querySelector("div[role='button']"))
    .slice(1)
    .map((div) => div.text.trim())
    .join(", ");

  return { link, title, entreprise, publishedDate, website, type };
};

type Job = Awaited<ReturnType<typeof getJob>>;
const saveOnGoogleSheet = async (jobs: Job[]) => {
  const result = await service.spreadsheets.values.append({
    spreadsheetId: process.env.SPREADSHEET_ID,
    range: "Jobs",
    valueInputOption: "RAW",
    requestBody: {
      majorDimension: "ROWS",
      range: "Jobs",
      values: jobs.map((job) => [
        job.link,
        job.title,
        job.entreprise,
        job.website,
        job.type,
        job.publishedDate,
      ]),
    },
  });
};

const getAllJobs = async () => {
  console.log("Get existing jobs...");
  const existingJobsResponse = await service.spreadsheets.values.get({
    spreadsheetId: process.env.SPREADSHEET_ID,
    range: "Jobs",
  });

  const existingJobs =
    existingJobsResponse.data.values?.map((job) => job[0]) || [];

  console.log("Fetching jobs...");
  let links = [] as string[];
  let page = 0;
  let pageLinksCount = 1;

  while (pageLinksCount !== 0) {
    console.log(`Fetching page ${page}...`);
    const response = await fetch(
      `https://jobs.makesense.org/fr/s/jobs/all/all/freelance?sortBy=createdAt&items_page=${page}`
    );
    const html = await response.text();
    const root = parse(html);
    const pageLinks = root
      .querySelectorAll(".item")
      .map((job) => job.querySelector("a")?.getAttribute("href"))
      .filter((link) => link !== undefined && link.startsWith("/fr/jobs"))
      .map((link) => `${site}${link}`);
    page++;
    pageLinksCount = pageLinks.length;
    links = links.concat(pageLinks);
  }

  links = links.filter((link) => !existingJobs.includes(link));
  console.log(`Analysing ${links.length} jobs`);
  const jobs = [] as Job[];
  let i = 1;
  for (const link of links) {
    console.log(`${i}/${links.length} : ${link}...`);
    const job = await getJob(link);
    jobs.push(job);
  }

  console.log(`Saving ${jobs.length} jobs`);
  saveOnGoogleSheet(jobs);
};

getAllJobs();
