package http

import "github.com/google/uuid"

type errorResponse struct {
	Error   string `json:"error"`
	Message string `json:"message,omitempty"`
}

type createTicketRequest struct {
	Title        string     `json:"title" validate:"required,min=3,max=500"`
	Description  string     `json:"description" validate:"required,min=1"`
	Priority     string     `json:"priority" validate:"omitempty,oneof=low medium high urgent"`
	CategoryID   *uuid.UUID `json:"category_id,omitempty"`
	DepartmentID *uuid.UUID `json:"department_id,omitempty"`
}

type updateStatusRequest struct {
	Status string `json:"status" validate:"required,oneof=open in_progress pending_employee resolved closed cancelled"`
}

type assignRequest struct {
	AssigneeID uuid.UUID `json:"assignee_id" validate:"required"`
}

type createCommentRequest struct {
	Content    string `json:"content" validate:"required,min=1"`
	IsInternal bool   `json:"is_internal"`
}
