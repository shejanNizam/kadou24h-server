import { Request, Response } from "express";
import httpStatus from "http-status";
import catchAsync from "../../utils/catchAsync";
import sendResponse from "../../utils/sendResponse";
import { ApplicationStatus } from "./job.interface";
import { JobServices } from "./job.service";
import { enumQuery } from "../../utils/queryParams";

const createJob = catchAsync(async (req: Request, res: Response) => {
  const result = await JobServices.createJob(
    req.user._id,
    req.user.lastActiveMode || "customer",
    req.body,
  );
  sendResponse(res, {
    statusCode: httpStatus.CREATED,
    success: true,
    message: "Job post created successfully!",
    data: result,
  });
});

const updateJob = catchAsync(async (req: Request, res: Response) => {
  const result = await JobServices.updateJob(
    req.user._id,
    req.params.id as string,
    req.body,
  );
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Job post updated successfully!",
    data: result,
  });
});

const publishJob = catchAsync(async (req: Request, res: Response) => {
  const result = await JobServices.publishJob(
    req.user._id,
    req.params.id as string,
    req.body.paymentMethod,
  );
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Job published successfully for 30 days!",
    data: result,
  });
});

const closeJob = catchAsync(async (req: Request, res: Response) => {
  const result = await JobServices.closeJob(
    req.user._id,
    req.params.id as string,
  );
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Job closed successfully!",
    data: result,
  });
});

const searchJobs = catchAsync(async (req: Request, res: Response) => {
  const result = await JobServices.searchJobs({
    search: req.query.search as string,
    categoryId: req.query.categoryId as string,
    jobType: req.query.jobType as string,
    workplace: req.query.workplace as string,
    city: req.query.city as string,
    lat: req.query.lat ? Number(req.query.lat) : undefined,
    lng: req.query.lng ? Number(req.query.lng) : undefined,
    maxDistanceKm: req.query.maxDistanceKm ? Number(req.query.maxDistanceKm) : undefined,
    page: Number(req.query.page),
    limit: Number(req.query.limit),
  });
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Jobs retrieved successfully!",
    meta: result.meta,
    data: result.data,
  });
});

const getJobDetails = catchAsync(async (req: Request, res: Response) => {
  const result = await JobServices.getJobDetails(
    req.params.id as string,
    req.user?._id,
  );
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Job details retrieved successfully!",
    data: result,
  });
});

const applyToJob = catchAsync(async (req: Request, res: Response) => {
  const result = await JobServices.applyToJob(req.user._id, req.body);
  sendResponse(res, {
    statusCode: httpStatus.CREATED,
    success: true,
    message: "Application submitted successfully!",
    data: result,
  });
});

const applySpontaneous = catchAsync(async (req: Request, res: Response) => {
  const result = await JobServices.applySpontaneous(req.user._id, req.body);
  sendResponse(res, {
    statusCode: httpStatus.CREATED,
    success: true,
    message: "Spontaneous application submitted successfully!",
    data: result,
  });
});

const getMyApplications = catchAsync(async (req: Request, res: Response) => {
  const result = await JobServices.getMyApplications(req.user._id, {
    page: Number(req.query.page),
    limit: Number(req.query.limit),
    status: enumQuery(req.query.status, ApplicationStatus, "status"),
  });
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "My applications retrieved successfully!",
    meta: result.meta,
    data: result.data,
  });
});

const getReceivedApplications = catchAsync(async (req: Request, res: Response) => {
  const result = await JobServices.getReceivedApplications(req.user._id, {
    page: Number(req.query.page),
    limit: Number(req.query.limit),
    status: enumQuery(req.query.status, ApplicationStatus, "status"),
  });
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Received applications retrieved successfully!",
    meta: result.meta,
    data: result.data,
  });
});

const getJobApplicants = catchAsync(async (req: Request, res: Response) => {
  const result = await JobServices.getJobApplicants(
    req.user._id,
    req.params.id as string,
    {
      page: Number(req.query.page),
      limit: Number(req.query.limit),
      status: enumQuery(req.query.status, ApplicationStatus, "status"),
      sortBy: enumQuery(req.query.sortBy, ["match", "date"] as const, "sortBy"),
    },
  );
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Job applicants retrieved successfully!",
    meta: result.meta,
    data: result.data,
  });
});

const updateApplicationStatus = catchAsync(async (req: Request, res: Response) => {
  const result = await JobServices.updateApplicationStatus(
    req.user._id,
    req.params.applicationId as string,
    req.body.status,
  );
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: `Application status updated to ${req.body.status}!`,
    data: result,
  });
});

const scheduleInterview = catchAsync(async (req: Request, res: Response) => {
  const result = await JobServices.scheduleInterview(
    req.user._id,
    req.params.applicationId as string,
    req.body,
  );
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Interview scheduled successfully!",
    data: result,
  });
});

const unlockCandidateCv = catchAsync(async (req: Request, res: Response) => {
  const result = await JobServices.unlockCandidateCv(
    req.user._id,
    req.params.applicantId as string,
    req.body.paymentMethod,
  );
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Candidate CV unlocked successfully!",
    data: result,
  });
});

const getMyJobs = catchAsync(async (req: Request, res: Response) => {
  const result = await JobServices.getMyJobs(req.user._id, {
    tab: enumQuery(req.query.tab, ["active", "draft", "closed"] as const, "tab"),
    page: Number(req.query.page),
    limit: Number(req.query.limit),
  });
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "My jobs retrieved successfully!",
    meta: result.meta,
    data: result.data,
  });
});

const getApplication = catchAsync(async (req: Request, res: Response) => {
  const result = await JobServices.getApplication(req.user._id, req.params.applicationId as string);
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Application retrieved successfully!",
    data: result,
  });
});

const withdrawApplication = catchAsync(async (req: Request, res: Response) => {
  const result = await JobServices.withdrawApplication(req.user._id, req.params.applicationId as string);
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Application withdrawn",
    data: result,
  });
});

const confirmInterview = catchAsync(async (req: Request, res: Response) => {
  const result = await JobServices.confirmInterview(req.user._id, req.params.applicationId as string);
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Interview confirmed",
    data: result,
  });
});

export const JobControllers = {
  getMyJobs,
  getApplication,
  withdrawApplication,
  confirmInterview,
  createJob,
  updateJob,
  publishJob,
  closeJob,
  searchJobs,
  getJobDetails,
  applyToJob,
  applySpontaneous,
  getMyApplications,
  getReceivedApplications,
  getJobApplicants,
  updateApplicationStatus,
  scheduleInterview,
  unlockCandidateCv,
};
